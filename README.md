# GitHub PR Stacks

A Chrome extension that groups the pull request list on github.com by stack. Each stack gets a header row and is listed from the bottom PR to the top one. PRs that are not part of a stack keep their place in GitHub's sort order.

A PR belongs to a stack when its base branch is another open PR's head branch. That works for stacks made with `gh stack`, Graphite, or by hand.

Each stack header ends with a progress bar: how many of its PRs are approved, and one segment per PR from bottom to top, coloured by where that PR stands. The bar is the same width on every stack, so they line up. When a PR is in more than one state, the first that applies wins:

| Colour | State |
|---|---|
| Purple | Merged |
| Grey | Draft, or closed without merging (lighter grey) |
| Red | Checks failing |
| Yellow | Changes requested |
| Orange | Checks running |
| Green | Approved |
| Blue | Ready for review |

With a token, states come from one GitHub API request per page. Without one, they're read from GitHub's list, which shows "Approved" and "Changes requested" only once a PR has reviews. Hover a segment for its PR number and state.

Stacks and bars refresh every minute while the tab is visible, and when you come back to the tab, so approvals, checks and merges show up without a reload; the page only redraws when something changed. With a token each refresh is one GitHub request. Without one, review states come from GitHub's list and update when you reload the page.

Every PR gets a header, so GitHub's newest and oldest sorts still apply: each stack sits where its highest-placed PR would be. Stack headers have a stack icon and a blue edge on their rows; single PRs have a pull request icon. A stack header is named from wording all its PR titles share, tried in this order: the same conventional-commit scope (`docs(pass-skills): ...`), the same label before a part number (`skill-port pt1: ...`), or the longest term in every title (`perf-calibration`). A stack whose titles share no wording is named after its bottom PR's branch.

## Setup

```sh
./setup.sh
```

The script copies your `gh` token to the clipboard, opens `chrome://extensions` and prints the remaining steps:

1. Turn on Developer mode.
2. Click "Load unpacked" and choose this folder.
3. Open the extension's Details, then "Extension options", paste the token and save.
4. Reload a pull request list.

A button in the bottom right of the PR list turns grouping on and off.

## Token

The extension reads each PR's base and head branch from the GitHub REST API. Any token that can read the repository's pull requests works:

- The output of `gh auth token`, which is what `setup.sh` uses. It carries all the scopes your `gh` login has.
- A fine-grained personal access token with read-only "Pull requests" access, if you want a narrower token.

If an organization enforces SAML single sign-on, the token must be authorized for that organization.

The token is kept in the extension's local storage in your browser. It is not synced and is only sent to `api.github.com`. Without a token the extension tries to read branch names from GitHub's own pages using your signed-in session; that depends on GitHub's page markup and may not work.

With a token, one GitHub request reads every PR on the page. Without one, each PR is read separately, up to 8 at a time. On later visits the stacks are drawn straight away from what was read last time, then brought up to date. A loader with the extension's icon shows next to the toggle until the stacks are first drawn.

Branch names are cached for 5 minutes, so a rebased stack can take that long to regroup.

If some pull requests can't be read, they get a "Branches unknown" header and a notice in the bottom right says why and what to change, such as a rejected or expired token, a token without access to the repository, single sign-on, or GitHub's rate limit. If none can be read, the list is left as GitHub shows it. "Try again" retries without reloading, and saving the options retries automatically. Dismissing the notice hides that problem until the tab is closed or the options change.

If GitHub can't be reached, branch names read in the last day are used instead. After GitHub rejects the token or hits its rate limit, the extension stops calling the API for that page until the limit resets or the options change.

## Tickets

Turn on "Ticket references" in the options to add a second line to each stack header with the stack's ticket keys and a short description.

Two sources are supported, and each can be turned off or moved up or down in the options. A stack shows references from the highest-priority source that finds any:

- Jira - keys like `ABC-123`.
- GitHub Issues - `#123` or `owner/repo#123` in titles and descriptions, and branches named the way GitHub's "Create a branch" names them (`123-fix-login`) or like `issue-123`. Issue titles are read from GitHub's API, with your token if one is saved. References GitHub doesn't know as issues, including pull requests, are left out.

- Keys are found in branch names, then PR titles. PR descriptions are checked only when neither has a key, because descriptions often mention follow-up tickets.
- Set project keys (for example `DATA, IDEA`) to ignore lookalikes such as `UTF-8`, or supply your own key pattern.
- Without a tracker, the description is the bottom PR's title with ticket keys and part numbers like `pt1/6` removed. A link template such as `https://example.atlassian.net/browse/{key}` makes the keys clickable.

To show ticket titles instead, choose Jira Cloud under "Ticket lookup" and enter your Jira URL (`https://<site>.atlassian.net`), account email and an API token from id.atlassian.com/manage-profile/security/api-tokens. Only Jira Cloud is supported.

Saving asks Chrome for access to your Jira site. Jira credentials are read only by the extension's background script and sent only to Jira. Use the Test button to check a key before reloading GitHub. Ticket titles are cached for 30 minutes.

## Limits

- github.com only. GitHub Enterprise Server hosts are not matched.
- Only PRs on the current page are grouped. A stack split across pages is grouped per page.

## Firefox

The same code runs in Firefox 140 and later, and Firefox for Android 142 and later. Firefox needs a slightly different manifest, so build it first:

```sh
npm run build
```

Then open `about:debugging#/runtime/this-firefox`, click "Load Temporary Add-on" and choose `dist/firefox/manifest.json`. Temporary add-ons are removed when Firefox closes.

Firefox shows what data an add-on sends before it sends it. This one sends nothing at install. Saving a GitHub token or Jira details asks for your OK to send them to GitHub or Jira, and they're not saved without it.

## Development

```sh
npm test              # unit tests
npm run build         # dist/chrome, dist/firefox and a store zip for each
npm run lint:firefox  # Mozilla's add-on linter, after a build
```

Icons are Octicons `stack-16` and `git-pull-request-16` from [primer/octicons](https://github.com/primer/octicons), MIT licensed.

After editing, click the reload icon on the extension's card in `chrome://extensions` and refresh the GitHub tab.

## License

MIT with the [Commons Clause](https://commonsclause.com/) condition. You can use, modify and fork it, but you can't sell it or a product or service built substantially on it, and forks must keep this condition. See [LICENSE](LICENSE).
