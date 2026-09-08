# 🗑️ Mis Cartones

Un ciudadano recoge cinco bolsas de basura de un terreno y las lleva a su carretilla. Cada
bolsa que vacía revienta en **cartones** que vuelan al saldo.

Juego hermano de **La Llave Correcta** (`llaveMental`): misma economía, misma seguridad y
el mismo módulo de pagos, con un juego y un motor gráfico distintos.

**Stack:** Next.js 16 (Turbopack) · TypeScript · **three.js** (3D low-poly) · Supabase · Tailwind 4 · Vercel

El plan completo está en [`PLAN.md`](./PLAN.md).

---

## Empezar

```bash
npm install
npm run dev
```

Abre <http://localhost:3000> y toca **JUGAR**.

**Funciona sin configurar nada.** Mientras no haya proyecto de Supabase, la partida corre
en **modo demo**: local, sin dinero, pero usando el **mismo RNG y el mismo reparto que el
servidor de producción** (`lib/game/demo.ts`). Es a propósito — las fases 1 y 3 del plan,
que son las que deciden si el juego se siente bien, se pueden trabajar enteras sin base
de datos.

### Cómo se juega

- **Mantén el dedo** (o el ratón) apoyado en la pantalla: el ciudadano camina hacia ahí.
  El dedo nunca tapa al personaje, que es el problema número uno del táctil.
- Un toque corto también vale: camina hasta ese punto y se detiene solo.
- Teclado: `WASD` o las flechas.
- Pasa por encima de una bolsa para **cargarla al hombro**. Solo se puede llevar una.
- Llévala a la **carretilla** para vaciarla. Ahí es donde salen los cartones y donde
  se cobra.
- Chocar con un obstáculo cargando te hace **soltar la bolsa**, no perderla:
  se pierde tiempo, nunca dinero.

---

## Estado actual

| Fase del plan | Estado |
|---|---|
| 0 · Andamiaje | ✅ Next 16, TypeScript, Tailwind, `proxy.ts`, listo para Vercel |
| 1 · Prototipo jugable | ✅ Motor **3D low-poly** en three.js. Geometría generada por código, sin assets |
| 2 · Servidor y economía | ✅ RNG, `bagSplit`, `world`, los dos endpoints con reclamo atómico, migraciones 001-003 |
| 3 · Sensación | 🟡 Parcial: hitstop, partículas, temblor, cámara lenta, braceo, sonido y ambiente de campo, vibración, reposo. Falta pulir con arte definitivo |
| 4 · Pagos y OCR | ⬜ Pendiente |
| 5 · Alrededores | ⬜ Pendiente (auth, billetera, admin, referidos) |
| 6 · Arte final | ⬜ Pendiente |

> **Todavía no hay registro ni login.** Las rutas del servidor ya los exigen, pero la
> pantalla no existe: por eso el juego cae a modo demo. Entra en la Fase 5.

---

## Comandos

```bash
npm run dev        # servidor de desarrollo (Turbopack)
npm run build      # build de producción
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint 9 flat config
npm test           # ⭐ pruebas de economía y de escenarios
```

### Las pruebas

`npm test` es el criterio de aceptación de la Fase 2, y conviene correrlo antes de
cualquier cambio que toque `lib/game/`:

- **RTP sobre 1.000.000 de partidas simuladas en secuencia**, con el corta-rachas
  aplicado igual que en producción → debe dar **98,03 % ± 0,1**.
- Nunca tres consolaciones seguidas.
- Las 5 partes de `bagSplit` suman **exacto** el premio (60.000 repartos).
- La bolsa mayor cae en las tres primeras entregas; la última se lleva la segunda mayor.
- Determinismo: misma semilla → mismo escenario; mismo id de partida → mismo reparto.
- **10.000 escenarios generados al azar**: ninguna bolsa fuera del área, encima de un
  obstáculo, amontonada con otra, ni **aislada de la carretilla**.

> ⚠️ **La tabla de premios sola paga 96,59 %.** El 98,03 % de producción sale de la tabla
> **más** el corta-rachas de `drawSessionTier()`. Si alguien quita esa regla o deja de
> pasarle los dos últimos premios, el RTP cae 1,4 puntos y nada avisa. Por eso la regla
> vive en `lib/game/rng.ts` (no dentro de la ruta) y por eso la prueba la mide.

---

## Conectar Supabase

1. Crea un proyecto en [supabase.com](https://supabase.com).

2. Copia las variables:

   ```bash
   cp .env.local.example .env.local
   ```

   ```env
   NEXT_PUBLIC_SUPABASE_URL=https://tu-proyecto.supabase.co
   NEXT_PUBLIC_SUPABASE_ANON_KEY=tu-anon-key
   SUPABASE_SECRET_KEY=tu-service-role-key     # solo servidor: salta RLS
   ```

3. En el **SQL Editor** del panel de Supabase, ejecuta las migraciones de
   `supabase/migrations/` **en orden numérico**:

   ```
   001_base.sql        players, game_runs, game_history, app_events, RLS, alta de jugador
   002_rpc_juego.sql   spend_ticket, credit_prize, is_admin
   003_integridad.sql  índices únicos: una partida activa, una entrada de historial
   ```

   Las migraciones **se corren a mano**: el código nunca ejecuta DDL.

4. Reinicia `npm run dev`. El lobby dirá «Supabase: conectado» y el juego dejará de
   usar el modo demo.

5. Para darte tickets mientras no existe la pantalla de compra (Fase 4):

   ```sql
   UPDATE public.players SET tickets = 20
   WHERE id = (SELECT id FROM auth.users WHERE email = 'tu@correo.com');
   ```

### Crear un administrador

El admin no se registra como admin: crea la cuenta normal y luego promuévela.

```sql
UPDATE public.players SET role = 'admin'
WHERE id = (SELECT id FROM auth.users WHERE email = 'admin@tudominio.com');
```

---

## Desplegar en Vercel

```bash
npx vercel --prod
```

Vercel detecta Next.js solo. Añade en **Project → Settings → Environment Variables**:

- `NEXT_PUBLIC_SUPABASE_URL`
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`
- `SUPABASE_SECRET_KEY`

Y en Supabase (**Auth → URL Configuration**):

- Site URL: `https://tu-app.vercel.app`
- Redirect URL: `https://tu-app.vercel.app/auth/callback`

> **Node 22.** El proyecto compila y corre con Node 20, pero `@supabase/supabase-js` ya
> avisa de que lo va a dejar de soportar. En Vercel elige **Node.js 22.x** en Settings →
> General, y en local conviene actualizar.

---

## Cómo está organizado

```
app/
  page.tsx              Lobby
  juego/page.tsx        Pantalla de juego: orquesta partida, HUD y modo demo
  api/buy-ticket/       Consume ticket, SELLA el premio con el RNG, emite world_seed
  api/deposit-bag/      ⭐ Reclamo atómico. El único endpoint que paga
  api/session/          Reanudar una partida a medias

components/game/
  GameCanvas.tsx        La ÚNICA frontera React ↔ three.js. Monta y destruye el motor
  Hud.tsx               Saldo, entregas, silencio (DOM encima del canvas, no 3D)

lib/game/               Lógica pura, compartida cliente/servidor
  rng.ts                crypto.getRandomValues + corta-rachas
  constants.ts          PAYOUT_TABLE de 23 tramos (portada sin tocar)
  bagSplit.ts           Reparto determinista del premio en 5 partes
  world.ts              Colocación determinista del escenario desde la semilla
  demo.ts               Partida local sin Supabase

lib/three/              El motor 3D. TypeScript puro, CERO React
  game.ts               Bucle de paso fijo, movimiento, colisiones, recogida, entrega
  escena.ts             Geometría low-poly por código (árboles, terreno, personaje)
  fx.ts                 Cartones y polvo en InstancedMesh, temblor, destello
  audio.ts              Sonido sintetizado con WebAudio (sin archivos)

supabase/migrations/    Se ejecutan a mano, en orden
scripts/pruebas.mjs     npm test
proxy.ts                Refresco de sesión de Supabase (en Next 16 ya no es middleware.ts)
```

### Dos cosas que conviene no romper

**El reclamo atómico** (`app/api/deposit-bag/route.ts`). El `UPDATE` solo toca la fila si
`bags_deposited` sigue siendo *exactamente* el array que se leyó. Si otra petición llegó
antes, no toca nada y esa petición no acredita. Sin esto, veinte peticiones con la misma
bolsa pagan veinte veces — pasó de verdad en el juego hermano el 19/08/2026.

**La destrucción del motor** (`components/game/GameCanvas.tsx` y el `destroy()` de
`lib/three/game.ts`). Si no se libera el renderizador, cambiar de pantalla y volver deja
el contexto WebGL vivo y crea otro. A la tercera partida el teléfono se muere. Por eso
`destroy()` recorre la escena liberando cada geometría y cada material, llama a
`renderer.dispose()` y fuerza la pérdida del contexto. React 19 en StrictMode monta cada
efecto dos veces en desarrollo justamente para que esto se note enseguida.

---

## Cómo se mantiene barato el 3D

Lo que hunde los fps en un teléfono flojo no son los polígonos. Son estas tres cosas, y
las tres están evitadas por diseño:

- **Sin sombras en tiempo real.** Cada luz con sombra redibuja la escena entera. En su
  lugar, cada objeto lleva una mancha oscura plana debajo, que cuesta un círculo.
- **Todo lo repetido va en `InstancedMesh`.** Las 190 flores son UNA llamada de dibujo.
  Igual la hierba, los árboles, los arbustos, los obstáculos por tipo y los cartones.
- **Materiales baratos.** `MeshLambertMaterial` con caras planas, nada de PBR. Dos luces
  en total. Sin post-procesado. Densidad de píxeles topada en 2.

La escena queda en unas 40 llamadas de dibujo y ~6.000 triángulos, y el suelo entero es
**una malla** cuyos vértices llevan el color (pasto, zonas secas y el camino de tierra),
así que no usa ni una textura.

> **Pendiente de verificar:** los 60 fps sostenidos durante 3 minutos en un Android de
> gama baja **real**. Es la puerta de calidad de la Fase 1 y con el cambio a 3D se vuelve
> a abrir. Hasta que no se mida en un aparato, el rendimiento es una expectativa razonada,
> no un hecho.

---

## Qué falta para que se sienta terminado

Lo que más se nota, por orden:

1. **Medir los fps en un teléfono real.** Es lo único que decide si el 3D se queda.
2. **Registro y login** — sin eso no hay dinero, solo demo.
3. Compra de tickets con Pago Móvil, OCR y validación contra el banco (Fase 4).
