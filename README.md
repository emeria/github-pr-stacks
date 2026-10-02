# GitHub PR Stacks

A Chrome extension that groups the pull request list on github.com by stack. Each stack gets a header row and is listed from the bottom PR to the top one. PRs that are not part of a stack keep their place in GitHub's sort order.

A PR belongs to a stack when its base branch is another open PR's head branch. That works for stacks made with `gh stack`, Graphite, or by hand.

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

Branch names are cached for 5 minutes, so a rebased stack can take that long to regroup.

If some pull requests can't be read, they get a "Branches unknown" header and a notice in the bottom right says why and what to change, such as a rejected or expired token, a token without access to the repository, single sign-on, or GitHub's rate limit. If none can be read, the list is left as GitHub shows it. "Try again" retries without reloading, and saving the options retries automatically. Dismissing the notice hides that problem until the tab is closed or the options change.

While branch names are being read, a spinner with the extension's icon shows next to the toggle. If GitHub can't be reached, branch names read in the last day are used instead. After GitHub rejects the token or hits its rate limit, the extension stops calling the API for that page until the limit resets or the options change.

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

## Development

```sh
node --test
```

Icons are Octicons `stack-16` and `git-pull-request-16` from [primer/octicons](https://github.com/primer/octicons), MIT licensed.

After editing, click the reload icon on the extension's card in `chrome://extensions` and refresh the GitHub tab.

## License

MIT with the [Commons Clause](https://commonsclause.com/) condition. You can use, modify and fork it, but you can't sell it or a product or service built substantially on it, and forks must keep this condition. See [LICENSE](LICENSE).
