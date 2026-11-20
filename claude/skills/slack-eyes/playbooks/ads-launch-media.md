# Ads launch media: video too large, too long, wrong shape

Use when: a brand says an ad launch failed on a video ("larger than 256 MB", "over 60 seconds", "portrait 9:16"),
asks SideShift to compress or convert creator videos, or a launch item shows a media reason (AppLovin first; the
same questions come for other platforms).

## Find the failed items (read replica)

```sql
select tenant_id, label, reason, updated_at from operation_items
where reason ilike '%MB, the most SideShift%' order by updated_at desc limit 20;
```

The item's ad source is inside its operation's input:
`jsonb_path_query_first(o.input, ('$.**.ads[' || (replace(oi.key,'ad-','')::int - 1) || '].source')::jsonpath)`
(join `operations o on o.id = oi.operation_id`). A `submission` source is a file in our bucket under
`video-submissions/<contractId>/`.

## Facts proven on 2026-11-19 (`request: applovin compress`, PR #11260)

- AppLovin launches run in the operations Cloud Run worker (`services/operations`, 2 CPU, 2Gi, in-memory /tmp,
  job expiry 900 s in `lib/operations/store.sql.ts`). ffmpeg there is the bundled `@ffmpeg-installer/linux-x64@4.1.0`:
  no `force_divisible_by`, no `source_fps` in filters.
- Since #11260 a stored submission over 256 MB (up to 512 MB, at most 60 s) is compressed in the worker
  (`lib/ads/providers/applovin/compress.ts`) to an H.264 MP4 inside 1080×1920 at ≤30 fps. Platform videos (tracked
  posts, YouTube) over 256 MB are still refused.
- Phone 4K 60 fps H.264 recordings run about 7 MB a second: 38-58 s clips were 272-411 MB. A 404 MB one compressed
  to 49 MB; encoding it costs about 105 CPU seconds.
- ffmpeg reading a phone MP4 from a signed HTTPS link is unusable: it seeks between tracks one request at a time,
  and a copy-only read of 404 MB ran over 10 minutes. Copy the file first (`file.download({ destination })`).
- To run media code against production from a worktree: `NODE_OPTIONS="--conditions=react-server
  --conditions=sideshift-src" npx tsx --env-file=.env.local <script>` (without the conditions, `server-only` throws).

## Reply

A failed launch item does not retry by itself: the brand relaunches those ads after the fix deploys.
