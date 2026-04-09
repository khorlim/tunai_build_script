const H3 = /^###\s*(.+?)\s*$/;

/**
 * Extract `### User Visible Changes` and `### Risk Level` blocks (case-insensitive). Not used for tester changelog output (that uses the full body); kept for callers who want structured fields.
 * @param {string} body
 * @returns {{ userVisible: string | null, riskLevel: string | null }}
 */
export function extractPrTesterSections(body) {
  if (!body?.trim()) return { userVisible: null, riskLevel: null };
  const lines = body.split('\n');
  /** @type {'userVisible' | 'riskLevel' | null} */
  let collecting = null;
  const uv = [];
  const risk = [];
  for (const line of lines) {
    const hm = line.match(H3);
    if (hm) {
      const title = hm[1].trim().toLowerCase();
      if (title === 'user visible changes') {
        collecting = 'userVisible';
        continue;
      }
      if (title === 'risk level') {
        collecting = 'riskLevel';
        continue;
      }
      collecting = null;
      continue;
    }
    if (collecting === 'userVisible') uv.push(line);
    else if (collecting === 'riskLevel') risk.push(line);
  }
  const trimBlock = (arr) => {
    const s = arr.join('\n').replace(/\s+$/u, '').trim();
    return s.length > 0 ? s : null;
  };
  return {
    userVisible: trimBlock(uv),
    riskLevel: trimBlock(risk),
  };
}

/**
 * @param {string} commitBlock first line `shortSha subject`, optional following body lines
 * @returns {{ shortSha: string, subject: string, firstLine: string, body: string }}
 */
export function splitCommitBlock(commitBlock) {
  const lines = commitBlock.split('\n');
  const firstLine = lines[0].trim();
  // Allow ASCII space or en/em dash between shortSha and subject (git uses space; pasted lines may use —).
  const m = firstLine.match(
    /^([0-9a-f]{4,40})(?:\s+|\s*[\u2013\u2014]\s+)(.+)$/iu,
  );
  const shortSha = m ? m[1] : '';
  const subject = m
    ? m[2]
        .trim()
        .replace(/^[\u2013\u2014\-–]\s*/u, '')
        .trim()
    : firstLine;
  const body = lines.slice(1).join('\n').trim();
  return { shortSha, subject, firstLine, body };
}

/**
 * GitHub squash titles often end with `(#46)`.
 * @param {string} subject
 * @returns {number | null}
 */
export function extractPrNumberFromSubject(subject) {
  const m = subject.match(/\(#(\d+)\)\s*$/);
  if (m) return parseInt(m[1], 10);
  const m2 = subject.match(/\(#(\d+)\)/);
  if (m2) return parseInt(m2[1], 10);
  return null;
}

/**
 * Remove trailing ` (#123)` from a squash commit subject for display fallbacks.
 * @param {string} subject
 */
export function stripPrMarkerFromSubject(subject) {
  return subject.replace(/\s*\(#\d+\)\s*$/u, '').trim();
}

/**
 * @param {string} url output of `git remote get-url origin`
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubRepoFromRemoteUrl(url) {
  if (!url?.trim()) return null;
  const u = url.trim();
  const scp = u.match(/^git@github\.com:([^/]+)\/([^/.]+?)(?:\.git)?$/i);
  if (scp) return { owner: scp[1], repo: scp[2] };
  const https = u.match(
    /^https?:\/\/(?:[^@/]+\@)?github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?(?:\/|$)/i,
  );
  if (https) return { owner: https[1], repo: https[2] };
  return null;
}

/**
 * @param {string} s `owner/repo`
 * @returns {{ owner: string, repo: string } | null}
 */
export function parseGithubRepoArg(s) {
  const m = String(s).trim().match(/^([^/]+)\/([^/]+)$/);
  if (!m) return null;
  return { owner: m[1], repo: m[2].replace(/\.git$/i, '') };
}
