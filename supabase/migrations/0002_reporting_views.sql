-- Reporting views. security_invoker makes them run with the caller's RLS, so tenants still can't see each other.

create or replace view campaign_funnel with (security_invoker = true) as
select
  c.workspace_id,
  c.id as campaign_id,
  c.name as campaign_name,
  coalesce(m.spend, 0) as spend,
  coalesce(m.impressions, 0) as impressions,
  coalesce(m.clicks, 0) as clicks,
  coalesce(l.leads, 0) as leads,
  coalesce(l.qualified, 0) as qualified,
  coalesce(l.booked, 0) as booked,
  coalesce(l.shows, 0) as shows,
  coalesce(d.won, 0) as won,
  coalesce(d.revenue, 0) as revenue
from campaigns c
left join (
  select campaign_id, sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks from metrics group by campaign_id
) m on m.campaign_id = c.id
left join (
  select campaign_id,
         count(*) leads,
         count(*) filter (where qualified_at is not null) qualified,
         count(*) filter (where booked_at is not null) booked,
         count(*) filter (where showed_at is not null) shows
  from leads where tier <> 'DISQUALIFIED' or qualified_at is not null group by campaign_id
) l on l.campaign_id = c.id
left join (
  select campaign_id, count(*) won, sum(contract_value) revenue from deals where status = 'won' group by campaign_id
) d on d.campaign_id = c.id;

create or replace view creative_funnel with (security_invoker = true) as
select
  cr.workspace_id,
  cr.id as creative_id,
  cr.name as creative_name,
  cr.status,
  coalesce(m.spend, 0) as spend,
  coalesce(m.impressions, 0) as impressions,
  coalesce(m.clicks, 0) as clicks,
  coalesce(l.leads, 0) as leads,
  coalesce(l.qualified, 0) as qualified,
  coalesce(l.booked, 0) as booked,
  coalesce(l.shows, 0) as shows,
  coalesce(d.won, 0) as won,
  coalesce(d.revenue, 0) as revenue
from creatives cr
left join (select creative_id, sum(spend) spend, sum(impressions) impressions, sum(clicks) clicks from metrics group by creative_id) m on m.creative_id = cr.id
left join (
  select creative_id, count(*) leads,
         count(*) filter (where qualified_at is not null) qualified,
         count(*) filter (where booked_at is not null) booked,
         count(*) filter (where showed_at is not null) shows
  from leads group by creative_id
) l on l.creative_id = cr.id
left join (select creative_id, count(*) won, sum(contract_value) revenue from deals where status = 'won' group by creative_id) d on d.creative_id = cr.id;
