-- org_id (added in 20260719020000) is now the real access-control column.
-- The old user_id column is repurposed as pure attribution -- who created
-- the project, not who can access it -- and renamed accordingly.
alter table public.projects rename column user_id to created_by;
