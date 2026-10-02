# GitHub PR Stacks

A Chrome extension that groups the pull request list on github.com by stack. Each stack gets a header row and is listed from the bottom PR to the top one. PRs that are not part of a stack keep their place in GitHub's sort order.

A PR belongs to a stack when its base branch is another open PR's head branch. That works for stacks made with `gh stack`, Graphite, or by hand.

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

## Limits

- github.com only. GitHub Enterprise Server hosts are not matched.
- Only PRs on the current page are grouped. A stack split across pages is grouped per page.

## Development

```sh
node --test
```

After editing, click the reload icon on the extension's card in `chrome://extensions` and refresh the GitHub tab.
