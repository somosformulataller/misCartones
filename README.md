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

**Hace falta Supabase.** Sin él la app arranca, pero no hay sesión, ni compras, ni
partidas: cada pantalla lo dice y para. Es a propósito — este juego paga dinero real y
una partida de mentira que no se distingue de una de verdad es la peor cosa que puede
enseñar. Configúralo en «Conectar Supabase», más abajo.

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
| 4 · Pagos y OCR | 🟡 El código está: compra, comprobante, OCR y cotejo contra el banco. **Faltan las variables del banco y del OCR**, y una cuenta receptora propia |
| 5 · Alrededores | ✅ Registro, billetera, compra, referidos, perfil y panel de administración (migraciones 004-005) |
| 6 · Arte final | ⬜ Pendiente |
| — · PWA | ✅ Instalable, con botón de descarga en el login |

> Las migraciones se corren a mano, en orden, desde el editor SQL de Supabase.

---

## Comandos

```bash
npm run dev        # servidor de desarrollo (Turbopack)
npm run build      # build de producción
npm run typecheck  # tsc --noEmit
npm run lint       # ESLint 9 flat config
npm test           # ⭐ pruebas de economía, escenarios, panel y PWA
```

Y dos herramientas de escritorio, que se corren a mano y no forman parte de la app:

```bash
node scripts/generar-iconos.mjs                    # redibuja los iconos de la PWA
node scripts/crear-cuentas.mjs "Clave1" "Clave2"   # cuentas de prueba (admin + jugador)
node scripts/verificar-supabase.mjs                # comprueba la base contra las migraciones
```

`crear-cuentas` y `verificar-supabase` usan la clave de servicio de `.env.local`, que se
salta RLS entera. Por eso viven aquí y no en una ruta de la app.

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

4. Reinicia `npm run dev`. El lobby dirá «Supabase: conectado».

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

**Este UPDATE hay que correrlo una sola vez, a mano.** No hay migración que lo haga:
una que reparta el rol de administrador es una que, copiada a otra base, reparte el
control del dinero. A partir del primer admin, las cuentas del equipo se crean desde el
propio panel (**Equipo**), donde además queda anotado quién las creó.

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
  juego/page.tsx        Pantalla de juego: orquesta partida y HUD
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

lib/three/              El motor 3D. TypeScript puro, CERO React
  game.ts               Bucle de paso fijo, movimiento, colisiones, recogida, entrega
  escena.ts             Geometría low-poly por código (árboles, terreno, personaje)
  fx.ts                 Cartones y polvo en InstancedMesh, temblor, destello
  audio.ts              Sonido sintetizado con WebAudio (sin archivos)

app/manifest.ts         Manifiesto de la PWA (Next lo sirve en /manifest.webmanifest)
components/pwa/
  BotonInstalar.tsx     El botón «Descargar la app» del login
  RegistrarSW.tsx       Registra el service worker (solo en producción)
public/
  sw.js                 Service worker. NUNCA guarda nada de /api/
  offline.html          Lo que se ve sin señal
  icon-*.png            Iconos, generados por scripts/generar-iconos.mjs

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

## La PWA: cómo se instala en el teléfono

Mis Cartones no está en Google Play ni en la App Store. Se instala desde el propio
navegador: es una **PWA**, y una vez instalada tiene icono propio, abre sin la barra de
direcciones y funciona igual que cualquier otra app del teléfono.

Se decidió así por una razón práctica, no técnica. La gente llega por un enlace de
WhatsApp. Mandarla a una tienda a buscar una app, aceptar permisos y esperar una
descarga pierde a la mayoría por el camino; y publicar un juego que paga dinero real en
una tienda abre una conversación con Apple y Google que este proyecto no necesita tener
todavía. Aquí el enlace de WhatsApp abre el juego, y el juego ofrece quedarse.

### Qué hace falta para que el navegador ofrezca instalarla

Chrome no enseña «instalar» por gusto: exige tres cosas a la vez, y si falta una no dice
nada, simplemente no aparece la opción. Las tres están puestas:

| Requisito | Dónde vive |
|---|---|
| Un manifiesto con nombre, iconos de 192 y 512, `start_url` y `display: standalone` | `app/manifest.ts` |
| Un service worker **con manejador de `fetch`** | `public/sw.js` |
| HTTPS | Vercel, de serie |

Además va un icono `maskable`. Sin él Android mete el nuestro dentro de un cuadrito
blanco y la app se ve como una página guardada, no como una app.

Los iconos se dibujan por código:

```bash
node scripts/generar-iconos.mjs
```

Es una pila de monedas sobre el verde de la marca. Se genera en vez de guardarse a mano
para que el repositorio no arrastre binarios que nadie sabe rehacer: cambiar el color de
la marca es cambiar una constante en ese script y volver a correrlo.

### El botón de descarga, en el login

`components/pwa/BotonInstalar.tsx`, debajo del formulario de `/auth/login`.

Va ahí y no en otro sitio porque el login es la única pantalla que ve **todo el mundo**,
y la ven antes de tener nada que perder. Va **debajo** del formulario, y en gris en vez
de en amarillo, porque compite con «Entrar a jugar»: si los dos gritaran igual, media
sala instalaría la app antes de tener cuenta.

El botón funciona de dos maneras según lo que permita el teléfono:

- **Android / Chrome de escritorio.** El navegador dispara `beforeinstallprompt`. Se
  intercepta (`preventDefault`) para que Chrome no saque además su propia barrita abajo
  — quedarían dos sitios desde donde instalar diciendo cosas distintas — y el botón abre
  el diálogo nativo del sistema.
- **iPhone.** Safari **nunca** dispara ese evento: en iOS no existe el diálogo, hay que
  ir a Compartir → «Añadir a pantalla de inicio». Así que el botón abre una hoja con los
  pasos escritos. Es lo importante del componente: sin esto, en la mitad de los teléfonos
  del país el botón sencillamente no existiría.

Y cuando alguien la instala de verdad —evento `appinstalled`, o `display-mode:
standalone` al abrir— el botón se retira solo. A quien ya la tiene no se le vuelve a
ofrecer.

### El service worker: qué se guarda y qué NO

`public/sw.js`. Esta es la parte con consecuencias, porque el juego mueve dinero.

**Nunca se guarda nada que empiece por `/api/`, ni ninguna respuesta a una petición que
no sea GET.** Un saldo, una lista de compras o un historial servidos desde la caché son
cifras viejas presentadas como actuales: el jugador que ve \$12 cuando tiene \$4 no piensa
«qué caché tan vieja», piensa que le robaron. Lo mismo con la sesión, que además podría
enseñarse al siguiente que abra el teléfono. **Que falle es preferible a que mienta.**

Lo que sí se guarda:

| Qué | Estrategia | Por qué |
|---|---|---|
| `/api/*` y todo lo que no sea GET | **nada, jamás** | Es dinero y sesión |
| Otros dominios (Supabase, el banco) | pasa de largo | No es nuestro |
| Navegar a una pantalla | red primero; sin red, `offline.html` | Detrás de cada pantalla hay un saldo |
| `/_next/static/*`, imágenes, fuentes, sonidos | caché primero | Llevan hash en el nombre: mismo nombre, mismo contenido |

Lo estático de Next es el único sitio donde la caché es gratis —si el nombre cambia el
contenido cambió— y es justo lo que hace que la app abra rápido en un teléfono de gama
baja, que es el teléfono de casi todos los jugadores.

Dos detalles que evitan fallos conocidos:

- Solo se guardan respuestas `ok` y de tipo `basic`. Una vez dentro de la caché, un 404
  se sirve para siempre.
- La caché lleva versión en el nombre (`mis-cartones-v1`). Al subir el número, en la
  siguiente visita se borra la anterior entera. **Súbelo si cambias `offline.html` o los
  iconos**, o la gente seguirá viendo los viejos.

El registro (`RegistrarSW.tsx`) espera al evento `load` y **no corre en desarrollo**. En
desarrollo estorba: deja servidas versiones viejas de los chunks y uno se pasa la tarde
persiguiendo un cambio que sí había guardado.

### Sin conexión

`public/offline.html`, HTML plano sin depender de nada. Dice lo obvio —no hay señal— y
una cosa menos obvia a propósito: **que los tickets y el saldo siguen guardados**. Quien
abre la app y ve una pantalla rara piensa primero en su dinero.

No hay modo sin conexión de verdad, y no lo habrá: una partida se sella en el servidor
(ahí se decide el premio con el RNG y se cobra el ticket), así que jugar sin red no
puede existir sin abrir la puerta a jugar gratis.

### Lo que cambia estando instalada

- Abre en `/juego`, no en el lobby. Quien la instaló ya sabe a qué viene; si no hay
  sesión, esa pantalla lo manda a entrar.
- Barra del sistema en `#0c2e24`, el mismo verde del manifiesto, del `themeColor` y del
  fondo de arranque. Tres colores distintos se ven como un borde mal pegado.
- Atajos largos sobre el icono: **Jugar**, **Mi billetera**, **Comprar tickets**.
- El contenido respeta `safe-area-inset`: a pantalla completa, sin eso el HUD se mete
  debajo de la muesca y de la raya de gestos.
- iOS no lee el manifiesto para nada de esto, así que el nombre bajo el icono, la barra
  de estado y el arranque a pantalla completa se le dicen aparte, en `appleWebApp`
  dentro de `app/layout.tsx`.

### Comprobarlo

`npm test` trae 21 comprobaciones sobre esto (apartado 9), y la que de verdad importa es
la que verifica que el service worker no toca `/api/`. En el teléfono, la prueba real es
más simple: instálala, ponla en modo avión, ábrela — debe salir la pantalla de sin
conexión, no la del dinosaurio — y vuelve a conectar.

> Ojo con una trampa de siempre: si ya visitaste el sitio antes de que existiera el
> service worker, hay que cerrar **todas** las pestañas del sitio para que el nuevo tome
> el control. En Chrome de escritorio: DevTools → Application → Service Workers.

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
2. **Cobrar de verdad** — cuenta propia en la API del banco y variables de OCR.
3. Compra de tickets con Pago Móvil, OCR y validación contra el banco (Fase 4).
