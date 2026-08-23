# Vicio Manager

App para votar si hoy se juega y cargar rangos horarios en formato 24 hs.

## Stack

- React + TypeScript + Tailwind para la web.
- Supabase para produccion gratuita.
- Python + SQLite como fallback local de desarrollo.
- Zona horaria fija: `America/Argentina/Buenos_Aires`.

## Ejecutar localmente

```bash
npm install
npm run dev
```

`npm run dev` levanta la web en `http://127.0.0.1:5173` y la API Python en `http://127.0.0.1:8000`.

## Usar Supabase

1. Crear un proyecto en Supabase.
2. Abrir el SQL Editor.
3. Ejecutar el contenido de `supabase/schema.sql`.
4. Copiar `.env.example` a `.env.local`.
5. Completar:

```bash
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key
```

Con esas variables, la app usa Supabase. Sin esas variables, usa la API Python local.

## Notificaciones y compartir resultados

### Discord automatico

La app puede avisar automaticamente en Discord cuando ya votaron todos los integrantes configurados.

1. En Discord, crear un webhook en el canal donde quieren recibir los resultados.
2. En Vercel, agregar estas variables de entorno:

```bash
DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/...
SUPABASE_SERVICE_ROLE_KEY=tu-service-role-key
NOTIFICATION_ADMIN_PIN=tu-pin-admin
```

`DISCORD_WEBHOOK_URL`, `SUPABASE_SERVICE_ROLE_KEY` y `NOTIFICATION_ADMIN_PIN` son secretos del servidor: no deben tener prefijo `VITE_`.

3. Ejecutar en Supabase el contenido actualizado de `supabase/schema.sql`.

La notificacion se envia una sola vez por dia gracias a la tabla `notification_events`. Si falta configurar Discord, los votos se guardan igual y la app simplemente omite el aviso.

### WhatsApp manual

En "Resultados del dia" hay un boton `WHATSAPP` que abre un mensaje prearmado con los votos y coincidencias para compartirlo en WhatsApp.

## Deploy en Vercel

1. Subir el repo a GitHub.
2. Importar el repo en Vercel.
3. Configurar el nombre deseado: `vicio-manager`.
4. Agregar las variables de entorno de Supabase en Vercel:
   - `VITE_SUPABASE_URL`
   - `VITE_SUPABASE_ANON_KEY`
   - `SUPABASE_SERVICE_ROLE_KEY`
   - `DISCORD_WEBHOOK_URL`
5. Deploy.

La URL esperada es:

```text
https://vicio-manager.vercel.app
```

Si el nombre no esta disponible, Vercel va a pedir una variante.
