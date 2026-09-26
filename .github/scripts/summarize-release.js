const MODEL = process.env.RELEASE_SUMMARY_MODEL || 'claude-haiku-4-5-20251001';
const ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_VERSION = '2023-06-01';

const SYSTEM_PROMPT = `You write release notes for a self-hosted WhatsApp
content-moderation bot. You'll be given a raw "What's Changed" list of
merged PR titles (often using conventional-commit prefixes like
feat/fix/chore/refactor/style).
Rewrite it as a short summary for the self-hoster running this bot, not
developers reading the diff:
- 3-6 bullet points grouped by what changes for someone running it (new
  behavior, fixes, deployment/config changes, other).
- Plain language: drop prefixes, PR numbers, usernames, and internal jargon.
- Skip purely internal changes (ci, chore, refactor, style, test) unless
  nothing else remains.
- No preamble, no closing remarks, just the bullets in Markdown.
- If only one bullet point remains, make it a single sentence instead.
- If there are no user-facing changes, return a single bullet point: "Internal improvements only."`;

module.exports = async ({ github, context, core }) => {
  const tag = process.env.TAG;
  const apiKey = process.env.ANTHROPIC_API_KEY;

  const { data: release } = await github.rest.repos.getReleaseByTag({
    owner: context.repo.owner,
    repo: context.repo.repo,
    tag,
  });

  if (!release.body || !release.body.trim()) {
    core.info('Release has no body to summarize, skipping.');
    return;
  }

  let summary;
  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': ANTHROPIC_VERSION,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        temperature: 0.3,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: release.body }],
      }),
    });

    if (!response.ok) {
      throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
    }

    const payload = await response.json();
    summary = payload.content?.[0]?.text?.trim();
    if (!summary) {
      throw new Error('Empty completion from model.');
    }
  } catch (error) {
    core.warning(`Skipping AI release summary, leaving auto-generated notes as-is: ${error}`);
    return;
  }

  if (process.env.APPLY !== 'true') {
    core.info(`Dry run (APPLY not set) — generated summary for ${tag}, not writing it back:\n\n${summary}`);
    return;
  }

  const newBody = `${summary}\n\n<details>\n<summary>Full changelog</summary>\n\n${release.body}\n\n</details>`;

  await github.rest.repos.updateRelease({
    owner: context.repo.owner,
    repo: context.repo.repo,
    release_id: release.id,
    body: newBody,
  });

  core.info(`Updated release ${tag} with an AI-generated summary (model: ${MODEL}).`);
};
