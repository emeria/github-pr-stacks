# Privacy Policy

GitHub PR Stacks is a browser extension that groups the pull request list on github.com by stack. This policy explains what the extension stores, where it sends data, and what it never does.

Effective date: October 2, 2026

## Summary

The extension has no server. Everything it stores stays in your browser. It sends data only to GitHub and, if you set one up, your ticket tracker. It does not collect analytics, show ads, or sell or share data with anyone.

## What the extension stores

All of the following is kept in your browser's local extension storage. It is not synced to other devices and is never sent to the developer.

- **GitHub token** (optional). Used to read each pull request's base and head branch.
- **Ticket tracker settings** (optional). Your Jira URL, Jira account email and API token or personal access token, or your Linear API key.
- **Display settings**, such as whether ticket references are shown, project keys, a key pattern and a link template.
- **Cached ticket details**: ticket titles, statuses and links fetched from your tracker, kept for up to 30 minutes.

The extension also caches pull request branch names, titles and descriptions in github.com's local storage in your browser for up to 5 minutes, so the list does not have to be re-read on every page load. It also remembers whether grouping is turned on.

## Where data is sent

- **api.github.com**: requests for pull request details, sent with your GitHub token if you saved one.
- **github.com**: requests for pull request pages, using your existing signed-in session when no token is set.
- **Your ticket tracker**, only if you configure one: your Jira site, or api.linear.app. The extension sends the ticket keys it found and your tracker credentials, and receives ticket titles and statuses. Chrome asks for your permission before the extension can contact a tracker.

Data is not sent anywhere else.

## What the extension does not do

- It does not collect personal information, browsing history or usage analytics.
- It does not run on sites other than github.com and the tracker you choose.
- It does not sell, rent or transfer your data to third parties.
- It does not use your data for advertising, creditworthiness or any purpose other than the extension's single feature.

The use of information received from Google APIs and the browser adheres to the [Chrome Web Store User Data Policy](https://developer.chrome.com/docs/webstore/program-policies/user-data-faq), including the Limited Use requirements.

## Removing your data

Clear the token and tracker fields in the extension's options and save, or remove the extension. Removing it deletes everything it stored in extension storage. The short-lived cache on github.com expires on its own, or can be cleared with your browser's site data settings.

## Changes

If this policy changes, the new version will be published at this address with a new effective date.

## Contact

Questions about this policy: open an issue at https://github.com/emeria/github-pr-stacks/issues.
