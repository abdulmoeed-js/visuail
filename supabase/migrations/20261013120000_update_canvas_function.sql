-- One artifact at a time. The project page used to save every artifact of a
-- project in one write, so a tab editing one artifact rewrote the others
-- from whatever copy it happened to hold, and two people on two artifacts of
-- the same project could overwrite each other. This replaces only the one
-- element of `canvases` the caller names, leaving the rest exactly as stored.
-- Runs as the caller (security invoker), so the projects row-level policies
-- still decide who may write.
create or replace function public.update_canvas(
  p_project_id uuid,
  p_canvas_id text,
  p_model jsonb default null,
  p_frame jsonb default null
) returns void
language sql
security invoker
set search_path = public
as $$
  update public.projects
  set canvases = (
        select coalesce(jsonb_agg(
          case when c->>'id' = p_canvas_id
            then c
              || (case when p_model is null then '{}'::jsonb else jsonb_build_object('model', p_model) end)
              || (case when p_frame is null then '{}'::jsonb else jsonb_build_object('frame', p_frame) end)
            else c end
          order by ord), '[]'::jsonb)
        from jsonb_array_elements(projects.canvases) with ordinality as t(c, ord)
      ),
      updated_at = now()
  where id = p_project_id;
$$;

grant execute on function public.update_canvas(uuid, text, jsonb, jsonb) to authenticated;
