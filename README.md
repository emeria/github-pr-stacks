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

## Tickets

Turn on "Ticket references" in the options to add a second line to each stack header with the stack's ticket keys and a short description.

- Keys are found in branch names, then PR titles. PR descriptions are checked only when neither has a key, because descriptions often mention follow-up tickets.
- Set project keys (for example `DATA, IDEA`) to ignore lookalikes such as `UTF-8`, or supply your own key pattern.
- Without a tracker, the description is the bottom PR's title with ticket keys and part numbers like `pt1/6` removed. A link template such as `https://example.atlassian.net/browse/{key}` makes the keys clickable.

To show ticket titles instead, choose a tracker under "Ticket lookup":

- Jira Cloud - your Jira URL, account email and an API token from id.atlassian.com/manage-profile/security/api-tokens.
- Jira Data Center or Server - your Jira URL and a personal access token.
- Linear - a personal API key.

Saving asks Chrome for access to the tracker's site. Tracker credentials are read only by the extension's background script and sent only to the tracker. Use the Test button to check a key before reloading GitHub. Ticket titles are cached for 30 minutes.

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
