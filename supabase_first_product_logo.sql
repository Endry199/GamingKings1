-- Ejecutar en Supabase SQL Editor para actualizar el logo del primer producto activo.
update public.productos
set logo_url = 'https://img.utdstc.com/icon/bb6/346/bb6346e8ac9c2a26b52e8fdfa69653676d93aea13411ca27f260ad1b8e81a4d7:600'
where id = (
  select id
  from public.productos
  where activo = true
  order by orden asc, nombre asc
  limit 1
);
