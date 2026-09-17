"""Optional Chrome integration smoke test. Requires Selenium and Chrome.

Run: python3 tests/browser/chrome.py --chrome /path/to/chrome
The test uses a temporary unpacked extension and a local HTTP fixture. It never
visits Reddit.
"""
import argparse
import json
from pathlib import Path
import shutil
import tempfile
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service
from selenium.webdriver.support.ui import WebDriverWait

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "src"


class FixtureHandler(BaseHTTPRequestHandler):
    def do_GET(self):
        self.send_response(200)
        self.send_header("Content-Type", "text/html; charset=utf-8")
        self.end_headers()
        self.wfile.write((ROOT / "tests/fixtures/infinite-feed.html").read_bytes())

    def log_message(self, *args):
        pass


def prepare_extension(destination, port):
    shutil.copytree(SOURCE, destination, dirs_exist_ok=True)

    manifest = json.loads((SOURCE / "manifest.json").read_text())
    fixture_origin = f"http://127.0.0.1:{port}/*"
    dnr_origin = f"http://localhost:{port}/*"
    for content_script in manifest["content_scripts"]:
        content_script["matches"] = [fixture_origin]
    isolated_script = next(
        script for script in manifest["content_scripts"]
        if script.get("world", "ISOLATED") == "ISOLATED"
    )
    isolated_script["js"].insert(0, "fixture-bridge.js")
    manifest["host_permissions"].extend([fixture_origin, dnr_origin])
    manifest["web_accessible_resources"][0]["matches"].extend([fixture_origin, dnr_origin])
    (destination / "manifest.json").write_text(json.dumps(manifest))
    rules_path = destination / "background/navigation-rules.js"
    rules_path.write_text(
        rules_path.read_text().replace(r"reddit\\.com", r"localhost"),
    )
    (destination / "fixture-bridge.js").write_text('''
document.documentElement.dataset.testExtensionId = chrome.runtime.id;
window.addEventListener("dereddit-test-settings", async (event) => {
  await chrome.storage.local.set(JSON.parse(event.detail));
  document.documentElement.dataset.testSettingsApplied = event.detail;
});
''')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--chrome", required=True, help="Path to Chrome or Chromium")
    parser.add_argument("--driver", help="Optional path to chromedriver")
    args = parser.parse_args()

    server = ThreadingHTTPServer(("127.0.0.1", 0), FixtureHandler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    try:
        with tempfile.TemporaryDirectory(prefix="dereddit-chrome-") as temp:
            extension = Path(temp) / "extension"
            extension.mkdir()
            prepare_extension(extension, server.server_port)

            options = Options()
            options.binary_location = args.chrome
            options.add_argument("--headless=new")
            options.add_argument("--no-sandbox")
            options.add_argument(f"--load-extension={extension}")
            service = Service(executable_path=args.driver) if args.driver else Service()
            driver = webdriver.Chrome(options=options, service=service)
            wait = WebDriverWait(driver, 15)
            try:
                driver.get(f"http://127.0.0.1:{server.server_port}/r/test/")
                wait.until(lambda _: driver.find_element("tag name", "html").get_attribute("data-test-extension-id"))
                extension_id = driver.find_element("tag name", "html").get_attribute("data-test-extension-id")

                def configure(settings):
                    driver.execute_script(
                        "document.documentElement.removeAttribute('data-test-settings-applied'); configure(arguments[0]);",
                        settings,
                    )
                    wait.until(lambda _: driver.find_element(
                        "tag name", "html"
                    ).get_attribute("data-test-settings-applied"))

                configure({
                    "limitInfiniteScroll": True,
                    "scrollLimit": 10,
                    "scrollMode": "fixed",
                })
                driver.execute_script('''
const rows = (start, count) => Array.from({length: count}, (_, index) => post(String(start + index)));
resetFeed(rows(0, 2), [{rows: rows(2, 10)}], true);
''')
                wait.until(lambda _: driver.execute_script("return shown().length") == 10)
                assert driver.execute_script("return loadCalls") == 1
                print("PASS Chrome page-world continuation loading", flush=True)

                configure({
                    "limitInfiniteScroll": True,
                    "scrollLimit": 3,
                    "scrollMode": "fixed",
                })
                driver.execute_script('''
resetFeed([post("a"), post("b"), post("c")], [{rows: [post("d"), post("e")]}], true);
document.querySelector("faceplate-partial").loadContent();
''')
                driver.execute_async_script("setTimeout(arguments[0], 200)")
                assert driver.execute_script("return loadCalls") == 0
                configure({"limitInfiniteScroll": False})
                wait.until(lambda _: driver.execute_script("return shown().length") == 5)
                assert driver.execute_script("return loadCalls") == 1
                print("PASS Chrome native-load guard and release", flush=True)

                configure({
                    "limitInfiniteScroll": True,
                    "scrollLimit": 3,
                    "scrollMode": "fixed",
                    "blockedSubreddits": [{"name": "blocked", "mode": "all"}],
                })
                driver.execute_script("resetFeed([post('a'),post('b','blocked'),post('c'),post('d'),post('e')])")
                wait.until(lambda _: driver.execute_script("return shown()") == ["t3_a", "t3_c", "t3_d"])
                print("PASS Chrome content filtering and fixed feed quota", flush=True)

                driver.get(f"chrome-extension://{extension_id}/popup/index.html?standalone=true")
                wait.until(lambda _: driver.find_element("id", "block-homepage").is_enabled())
                driver.find_element("id", "block-homepage").click()
                wait.until(lambda _: driver.find_element("id", "save-indicator").text == "Saved")
                response = driver.execute_async_script('''
const done = arguments[0];
chrome.runtime.sendMessage({action: "syncNavigationRules"}).then(done);
''')
                assert response == {"success": True}
                driver.get(f"http://localhost:{server.server_port}/")
                wait.until(lambda _: driver.current_url.startswith(f"chrome-extension://{extension_id}/blocked/index.html"))
                assert driver.current_url.split("#", 1)[1] == f"http://localhost:{server.server_port}/"
                assert driver.find_element("id", "block-message").text == "Reddit Homepage is blocked"
                print("PASS Chrome declarative main-frame redirect", flush=True)

                driver.get(f"chrome-extension://{extension_id}/popup/index.html?standalone=true")
                wait.until(lambda _: driver.find_element("id", "block-homepage").is_selected())
                assert not driver.find_elements("id", "block-nsfw")
                print("PASS Chrome popup persistence and removed legacy control", flush=True)
            finally:
                driver.quit()
    finally:
        server.shutdown()


if __name__ == "__main__":
    main()
