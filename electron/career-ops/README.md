# career-ops providers (vendored)

Job-board fetchers from [career-ops](https://github.com/santifer/career-ops)
(MIT, see `LICENSE`), commit `b54c484e592bba35dcd399629e7a60d44312d36b`.
Used by 小欧's 「找岗位」 through `run.mjs`, which the Next server runs as a
separate Node process.

Included: `providers/` feishu-jobs, mokahr, tencent, alibaba, meituan,
workday, successfactors, smartrecruiters, greenhouse, lever, ashby and the
`_*.mjs` helpers they import; `url-key.mjs`, `user-agent.mjs`,
`data-static/aggregator-domains.txt`.

Local changes:
- `providers/workday.mjs`: sends `entry.search_text` as the CXS `searchText`
  (upstream always sends an empty search).
- `run.mjs` is ours.

"career-ops" is the upstream project's name; this App is not affiliated with it.
