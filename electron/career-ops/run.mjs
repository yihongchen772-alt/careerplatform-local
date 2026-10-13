// 求职罗盘: runs career-ops' job-board providers for 小欧's 「找岗位」.
//
// Spawned as its own Node process (ELECTRON_RUN_AS_NODE) by the Next server:
// career-ops patches dns.lookup process-wide and keeps its own HTTP guards,
// which should not leak into the App's server. Reads one JSON request on
// stdin, writes one JSON result on stdout.
//
// stdin:  { boards: [{ name, careers_url, keywords?: string[] }], maxPages?, timeoutMs? }
// stdout: { results: [{ name, provider, jobs: [{title,url,location,company,postedAt}], error? }] }
import mokahr from './providers/mokahr.mjs';
import feishuJobs from './providers/feishu-jobs.mjs';
import tencent from './providers/tencent.mjs';
import alibaba from './providers/alibaba.mjs';
import meituan from './providers/meituan.mjs';
import workday from './providers/workday.mjs';
import successfactors from './providers/successfactors.mjs';
import smartrecruiters from './providers/smartrecruiters.mjs';
import greenhouse from './providers/greenhouse.mjs';
import lever from './providers/lever.mjs';
import ashby from './providers/ashby.mjs';
import { makeHttpCtx } from './providers/_http.mjs';

export const PROVIDERS = [feishuJobs, mokahr, tencent, alibaba, meituan, workday, successfactors, smartrecruiters, greenhouse, lever, ashby];

export function providerFor(entry) {
  for (const provider of PROVIDERS) {
    try {
      if (provider.detect?.(entry)) return provider;
    } catch { /* a detector that throws simply does not claim the board */ }
  }
  return null;
}

const MAX_JOBS_PER_BOARD = 400;

async function runBoard(board, { maxPages, timeoutMs }) {
  const entry = { name: board.name, careers_url: board.careers_url, keywords: board.keywords?.length ? board.keywords : undefined, search_text: board.keywords?.[0] ?? '', max_pages: maxPages };
  const provider = providerFor(entry);
  if (!provider) return { name: board.name, provider: null, jobs: [], error: 'unsupported' };
  const ctx = { ...makeHttpCtx(), maxPages };
  let timer;
  try {
    const jobs = await Promise.race([
      provider.fetch(entry, ctx),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('timeout')), timeoutMs); }),
    ]);
    return {
      name: board.name,
      provider: provider.id,
      jobs: (Array.isArray(jobs) ? jobs : []).slice(0, MAX_JOBS_PER_BOARD).map((job) => ({
        title: String(job.title || '').slice(0, 200),
        url: String(job.url || ''),
        location: String(job.location || '').slice(0, 120),
        company: String(job.company || board.name || '').slice(0, 100),
        postedAt: typeof job.postedAt === 'number' ? job.postedAt : null,
        description: typeof job.description === 'string' ? job.description.slice(0, 600) : '',
      })).filter((job) => job.title && /^https?:\/\//.test(job.url)),
    };
  } catch (error) {
    return { name: board.name, provider: provider.id, jobs: [], error: String(error?.message || error).slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

async function main() {
  let input = '';
  for await (const chunk of process.stdin) input += chunk;
  const request = JSON.parse(input || '{}');
  const boards = Array.isArray(request.boards) ? request.boards.slice(0, 30) : [];
  const options = { maxPages: Math.min(Math.max(Number(request.maxPages) || 3, 1), 10), timeoutMs: Math.min(Number(request.timeoutMs) || 25000, 60000) };
  // Quiet: providers report truncation on stderr, which is not an error here.
  console.error = () => {};
  console.warn = () => {};
  const results = [];
  // A few at a time: polite to the boards, quick enough for a chat reply.
  for (let i = 0; i < boards.length; i += 4) {
    results.push(...await Promise.all(boards.slice(i, i + 4).map((board) => runBoard(board, options))));
  }
  // Exit only once the pipe has taken all of it (a large result is
  // written in pieces; exiting right away cuts it off).
  await new Promise((resolve) => process.stdout.write(JSON.stringify({ results }), resolve));
}

if (process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop())) {
  main().then(() => process.exit(0), (error) => {
    process.stdout.write(JSON.stringify({ error: String(error?.message || error) }), () => process.exit(1));
  });
}
