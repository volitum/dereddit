# Privacy Policy for DeReddit

**Last updated: September 17, 2026**

DeReddit is an open-source browser extension designed to make Reddit less distracting and more intentional to use. It allows users to block selected Reddit pages and communities, filter content, simplify parts of the Reddit interface, and limit infinite scrolling.

This Privacy Policy explains what information DeReddit accesses or processes, how that information is used, and how it is stored.

## Summary

DeReddit is designed to operate locally in your browser.

* DeReddit does not send user data to the developer.
* DeReddit does not operate a server that receives extension data.
* DeReddit does not sell or share user data with third parties.
* DeReddit does not use analytics, telemetry, advertising trackers, or profiling services.
* DeReddit does not use user data for advertising or marketing.
* DeReddit does not download or execute remote code.
* Extension settings are stored locally in the browser.

DeReddit does locally access limited information from Reddit pages because this is necessary to provide its user-facing blocking, filtering, interface, and feed-limiting features.

## Information DeReddit Processes

### Reddit browsing information

DeReddit may locally process the URL of the Reddit page currently being viewed in order to:

* determine whether the page or subreddit matches a blocking rule;
* identify the current subreddit;
* apply page-specific filtering or interface changes;
* redirect blocked Reddit destinations to DeReddit's local block page; and
* distinguish between different Reddit feeds when applying feed limits.

When the user explicitly chooses the feature to add the current subreddit to the block list, DeReddit reads the URL of the active browser tab to determine whether it is a Reddit subreddit.

DeReddit does not build, store, or transmit a general history of websites visited by the user. Its website access is limited to Reddit domains.

### Reddit website content

DeReddit locally examines limited elements of Reddit pages as necessary to provide its features.

Depending on the enabled features, this may include information such as:

* subreddit names;
* Reddit page paths and links;
* post identifiers and permalinks;
* feed and post elements;
* information used to distinguish regular posts from promoted content; and
* interface elements that DeReddit may hide, filter, or limit.

This information is processed locally and transiently in the browser. DeReddit does not create a remote copy of Reddit page content and does not transmit this information to the developer or to third-party services.

### User settings

DeReddit stores settings explicitly configured by the user, including:

* blocked subreddit names or wildcard rules;
* blocking modes;
* Reddit page blocking preferences;
* interface visibility preferences;
* infinite-scroll limiting preferences;
* feed size limits; and
* related extension configuration.

These settings are stored using the browser's local extension storage.

## How Information Is Used

Information accessed by DeReddit is used only to provide the extension's user-facing functionality.

In particular, DeReddit uses locally processed Reddit URLs, page content, and user settings to:

* determine whether a Reddit destination should be blocked;
* hide posts from selected communities;
* hide selected Reddit interface elements;
* limit the number of posts displayed in Reddit feeds;
* control when additional Reddit feed content is shown; and
* maintain the preferences selected by the user.

DeReddit does not use this information for advertising, profiling, analytics, creditworthiness, lending, or any purpose unrelated to the extension's functionality.

## Local Storage and Retention

DeReddit stores its configuration using the browser's local extension storage.

These settings remain in the browser until they are changed by the user or the extension's local data is removed, including when the extension is uninstalled according to the browser's storage behavior.

DeReddit does not maintain a developer-operated database containing these settings.

Reddit page information inspected while the extension is operating is used for the current browsing experience and is not stored by DeReddit as a browsing-history database.

## Import and Export

DeReddit allows users to export their extension configuration as a JSON file and import a previously saved configuration.

Exporting a configuration creates a file locally in the user's browser. Importing a configuration reads only the file explicitly selected by the user.

Import and export operations do not send the configuration to the developer or to an external service.

Users should be aware that an exported configuration file may contain their blocked subreddit rules and extension preferences and should handle that file accordingly.

## Data Transmission and Sharing

DeReddit does not transmit user data to the developer and does not share or sell user data to third parties.

DeReddit does not include its own analytics, telemetry, advertising, or tracking network requests.

Normal use of Reddit still involves communication between the user's browser and Reddit. DeReddit may control or invoke Reddit's existing page functionality, including Reddit's native feed-loading mechanisms, as part of providing its feed-limiting features. Those Reddit network requests are part of the operation of the Reddit website and remain subject to Reddit's own privacy practices.

DeReddit does not send locally stored extension settings to Reddit.

## Personal and Sensitive Information

DeReddit is not designed to collect personally identifiable information, authentication credentials, financial information, health information, personal communications, or precise location information.

DeReddit does not request users to create a DeReddit account or provide their name, email address, password, payment information, or other account credentials.

Because DeReddit operates on Reddit pages, it may technically encounter website content while examining the page structure required for its features. Such content is processed locally only as necessary for those features and is not transmitted to the developer.

## Analytics, Advertising, and Tracking

DeReddit does not use:

* analytics services;
* telemetry services;
* advertising networks;
* tracking pixels;
* behavioral tracking services;
* fingerprinting;
* profiling services; or
* data brokers.

User data is not used or transferred for personalized advertising, retargeting, marketing profiles, creditworthiness, or lending purposes.

## Remote Code and External Services

All JavaScript, HTML, CSS, and other code required by DeReddit is included with the extension package.

DeReddit does not download or execute remote JavaScript or WebAssembly code.

DeReddit does not rely on a developer-operated backend service and does not make extension API requests to third-party services for analytics, tracking, or data processing.

## Browser Permissions

DeReddit requests only permissions required for its functionality.

### `storage`

Used to store the user's DeReddit settings locally in the browser.

### `declarativeNetRequest`

Used to create browser rules that redirect Reddit pages or subreddits blocked by the user to a local page bundled with DeReddit.

### Reddit host access

DeReddit is granted access to `reddit.com` and its subdomains so that it can run its content scripts, identify relevant Reddit pages and communities, apply blocking and filtering rules, modify selected interface elements, and provide feed-limiting functionality.

DeReddit does not request general access to unrelated websites.

## User Control and Deletion

Users control the settings stored by DeReddit through the extension interface.

Users can change or remove individual blocking rules and preferences at any time.

Users can also remove DeReddit's locally stored data by uninstalling the extension or by using browser-provided extension data controls where available.

Configuration files previously exported by the user are ordinary local files and must be deleted separately by the user if they are no longer wanted.

## Chrome Web Store Limited Use

The use of information received from Google APIs will adhere to the Chrome Web Store User Data Policy, including the Limited Use requirements.

DeReddit uses information accessed through browser permissions only to provide or improve its disclosed user-facing functionality.

DeReddit does not sell user data, transfer user data to advertising platforms or data brokers, use user data for personalized advertising, or use user data to determine creditworthiness or for lending purposes.

## Third-Party Websites

DeReddit operates on Reddit but is an independent project and is not affiliated with, endorsed by, or operated by Reddit.

Use of the Reddit website itself is subject to Reddit's own terms and privacy practices. This Privacy Policy describes DeReddit's handling of information and does not replace or modify Reddit's privacy policy.

## Changes to This Privacy Policy

This Privacy Policy may be updated if DeReddit's functionality or data practices change.

Any updated version will be published in the DeReddit source repository with an updated "Last updated" date.

Material changes to DeReddit's data practices will also be reflected in the extension's Chrome Web Store privacy disclosures where required.

## Contact

For questions, concerns, or requests regarding DeReddit and this Privacy Policy, please open an issue in the DeReddit GitHub repository:

https://github.com/volitum/dereddit/issues

Source code:

https://github.com/volitum/dereddit
