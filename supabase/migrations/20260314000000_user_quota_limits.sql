alter table public.app_users
  add column if not exists photo_quota_limit integer not null default 2,
  add column if not exists video_quota_limit integer not null default 0;

update public.app_users
set
  photo_quota_limit = case when plan = 'premium' then 85 else 2 end,
  video_quota_limit = case when plan = 'premium' then 2 else 0 end
where photo_quota_limit is null
   or video_quota_limit is null
   or (plan = 'premium' and photo_quota_limit = 2 and video_quota_limit = 0);

notify pgrst, 'reload schema';
