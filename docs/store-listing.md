# Store listing

Text for the Chrome Web Store and Firefox Add-ons forms, field by field. Build the packages with `npm run build`; images are in `docs/store/`.

## Shared copy

**Name:** GitHub PR Stacks

**Summary** (Chrome allows 132 characters and takes it from the manifest's `description`; Firefox allows 250):

> Groups GitHub's pull request list by stack, ordered bottom to top, with ticket keys in each stack header. No data collected.

**Description:**

> Working with stacked pull requests? GitHub lists them one by one, mixed in with everything else. GitHub PR Stacks groups them on the pull request list so each stack reads as one unit, from the bottom PR to the top.
>
> - A PR belongs to a stack when its base branch is another open PR's head branch. Stacks made with gh stack, Graphite or by hand all work.
> - Each stack gets a header with a name taken from its PR titles, how many PRs it has and the branch it lands on.
> - A progress bar on each stack shows how many PRs are approved, with one segment per PR: draft, checks running or failing, changes requested, ready for review, approved or merged. It refreshes every minute.
> - Optional ticket line: Jira keys like ABC-123 or GitHub issues like #123, with their titles. Choose which source wins and turn either off.
> - GitHub's own sort order still applies. Single PRs keep their place.
> - One button turns grouping on and off.
> - If GitHub can't be read, a notice says why and what to change, and the list is left as GitHub shows it.
>
> Works without setup on repositories you can see while signed in. A GitHub token (for example the output of `gh auth token`) makes it faster and more reliable.
>
> Privacy: we don't collect your data, and we never sell it. There is no server, no analytics and no tracking. Your token and settings stay in your browser and are only sent to GitHub, or to your own Jira Cloud site if you set one up.

**Support / homepage:** https://github.com/emeria/github-pr-stacks

**Issues:** https://github.com/emeria/github-pr-stacks/issues

**Privacy policy:** https://github.com/emeria/github-pr-stacks/blob/main/PRIVACY.md

## Chrome Web Store

Upload `dist/github-pr-stacks-chrome-<version>.zip`.

**Store listing tab**

- Category: Developer Tools
- Language: English
- Store icon: `icons/128.png`
- Screenshots (1280×800), in this order: `docs/store/screenshot-1-grouped.png`, `screenshot-2-grouped-tickets.png`, `screenshot-3-grouped-tickets-dark.png`, `screenshot-4-github-default.png` (GitHub's default order, for comparison). Firefox takes the same images.
- Small promo tile (440×280): `docs/store/promo-small-440x280.png`
- Marquee promo tile (1400×560, optional): `docs/store/promo-marquee-1400x560.png`

**Privacy tab**

- Single purpose:
  > Groups the pull request list on github.com by stack, so stacked pull requests are shown together in order.
- Permission justifications:
  - `storage`: Saves the user's settings and optional GitHub token in the browser.
  - Host permission `https://*.atlassian.net/*` (optional): Requested only when the user turns on Jira lookup, for the one Jira Cloud site they enter, to read ticket titles for the keys found in their pull requests.
  - Content script on `https://github.com/*`: Reads the pull request list and reorders it into stacks.
- Remote code: No, I am not using remote code. All code ships in the package.
- Data usage: leave every data type unchecked, then tick all three certifications:
  - I do not sell or transfer user data to third parties, outside of the approved use cases.
  - I do not use or transfer user data for purposes that are unrelated to my item's single purpose.
  - I do not use or transfer user data to determine creditworthiness or for lending purposes.
- Privacy policy URL: as above.

With no data types checked, the listing shows "The developer has disclosed that it will not collect or use your data", followed by the three certifications.

**Distribution tab:** Public, all regions. Free.

## Firefox Add-ons (addons.mozilla.org)

Upload `dist/github-pr-stacks-firefox-<version>.zip`. Choose "On this site" so it's listed, and tick both Firefox and Firefox for Android.

- Categories: Developer Tools (Firefox for Android: Other)
- License: "All Rights Reserved" is the closest standard choice; link the repo's LICENSE (MIT with the Commons Clause) in the description or the custom license field if offered.
- Source code: not required. The package is the source, with no minifier or bundler.
- Data collection: declared in the manifest. Firefox shows at install that the add-on collects no data, and asks before a saved token or Jira details are sent to GitHub or Jira.
- Notes for reviewers:
  > No build step; the zip contains the source as-is. To try it, open https://github.com/emeria/acme-storefront/pulls, a public demo repo with two stacks. No token or account is needed.
