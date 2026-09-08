# Mis Cartones — Plan de implementación

> Documento vivo. Versión 2 · 7 de septiembre de 2026.
> Proyecto hermano de **La Llave Correcta** (`llaveMental`). Misma economía,
> misma seguridad, mismo módulo de pagos. Juego distinto y motor gráfico distinto.
>
> **Cambio respecto a la v1:** el juego deja de ser un scroller de carro. Ahora es un
> **ciudadano** que recoge bolsas de basura de la calle y las lleva a su **carretilla**,
> todo en **una sola pantalla fija, sin scroll**.

---

## 0. Decisiones cerradas

| Tema | Decisión | Por qué |
|---|---|---|
| Proyecto Supabase | **Nuevo, desde cero** | Aislamiento total: un fraude, un bug de saldo o una migración rota en un juego no toca al otro. Contabilidad y RTP medibles por separado. |
| Motor de render | **PixiJS v8** (WebGL con caída a Canvas 2D) | ~130 KB gz contra ~600 KB de three.js. Batching de sprites y `ParticleContainer` para la lluvia de cartones. MIT, sin suscripción. |
| Pantalla | **Una sola pantalla fija, cenital 3/4, sin scroll** | Todo el escenario cabe de un vistazo: el jugador planifica su ruta. Y el coste de render se desploma (§8). |
| Personaje | **Ciudadano a pie**, no un vehículo | Recoge una bolsa, la carga hasta la carretilla y la vacía. El viaje de vuelta es lo que da tensión. |
| Control | **Caminar hacia donde presionas** (point‑and‑go) | El dedo nunca tapa al personaje. Idéntico con ratón. |
| Obstáculos | **Estorban, nunca castigan** | Las 5 bolsas siempre se depositan y el premio siempre se paga completo. La habilidad no toca el dinero → el RTP de 98,03 % queda matemáticamente intacto y auditable. |
| Hosting | Vercel + Supabase | Igual que llaveMental. |
| Framework | Next.js 16 (App Router) + TypeScript | Se reusa el 100 % del backend, el panel admin y los pagos. |

**No se paga ninguna suscripción de motor.** El presupuesto rinde muchísimo más en
arte (sprites cenitales y el ciclo de caminata) que en licencias.

---

## 1. Qué se conserva de llaveMental

Todo esto es lógica de servidor, agnóstica del render. Se porta **tal cual**, cambiando
solo nombres de dominio (llave → bolsa, moneda → cartón).

### 1.1 Motor de azar y economía — se copia sin tocar

| Archivo origen | Destino | Cambio |
|---|---|---|
| `lib/game/rng.ts` | `lib/game/rng.ts` | Ninguno. `crypto.getRandomValues`, nunca `Math.random`. |
| `lib/game/constants.ts` | `lib/game/constants.ts` | `TOTAL_KEYS` → `TOTAL_BAGS = 5`. La `PAYOUT_TABLE` de 23 tramos **no se toca**. |
| `lib/game/prizeSplit.ts` | `lib/game/bagSplit.ts` | Solo renombres. El algoritmo (FNV-1a + mulberry32 sembrado con el `session_id`) queda idéntico. |
| `lib/game/reveals.ts` | `lib/game/reveals.ts` | Los «ganchos» se muestran al final sobre las bolsas que no llegaron a la carretilla. |

Invariantes que se heredan y **no son negociables**:

- El destino de la partida se sella en el servidor al consumir el ticket (`drawPayoutTier`).
- Corta-rachas: nunca 3 consolaciones seguidas (se resortea entre los tramos de $2,10+).
- Las 5 partes suman **exacto** el premio (red de seguridad al final de `bagSplit`).
- La parte mayor sale en las 3 primeras entregas; la última se queda la segunda mayor.
- El cliente **jamás** conoce los montos por adelantado. Cada entrega devuelve el suyo.

### 1.2 Seguridad — se copia sin tocar

- **Reclamo atómico** (`app/api/try-key/route.ts`). Es lo más importante de todo el
  repositorio. Sin él, el 19/08/2026 un jugador cobró una partida de $2,50 veinte veces.
  Se replica igual en `/api/deposit-bag`.
- **Índices únicos de la migración 025**: una partida activa por jugador, una compra en
  verificación por jugador, un movimiento del banco = una sola compra.
- `lib/security/rateLimit.ts` (falla abierto a propósito), `lib/supabase/blocked.ts`,
  RLS en todas las tablas, `service_role` solo en servidor, middleware de Supabase SSR.
- El admin no puede jugar (evita mezclar la banca con el juego).

### 1.3 Pagos y OCR — se copian sin tocar

`lib/payments/*` completo: `bankApi.ts` (cerrojo doble por cuenta, multicuenta),
`ocr.ts` (servicio en Railway, timeout 15 s), `conciliar.ts`, `blocklist.ts`,
`origen.ts` (huella de origen), `exchangeRate.ts`, `validatePurchase.ts`,
más `/api/cron/revalidate` y su `CRON_SECRET`.

### 1.4 Qué NO se copia

`components/game/three/*` completo y `lib/perf/calidad.ts`. Ese código existe para un
juego **por turnos** donde la escena está quieta: `frameloop="demand"` + limitador a
24-30 fps fue lo que arregló el recalentamiento. Aquí hay movimiento continuo y hace
falta ritmo sostenido, así que la estrategia de rendimiento es otra (§8).

---

## 2. Diseño del juego

### 2.1 El bucle

1. El jugador toca **JUGAR**. Se consume 1 ticket ($2).
2. Aparece **una sola pantalla**: un tramo de calle visto desde arriba en 3/4, con
   **5 bolsas de basura repartidas** por el escenario, obstáculos, y la **carretilla**
   del ciudadano en un punto fijo.
3. El jugador **presiona la pantalla** y el ciudadano camina hacia ahí.
4. Al llegar a una bolsa, la **carga al hombro**. Camina más lento y ocupa más espacio.
5. La lleva hasta la **carretilla** y la vacía. **Ahí revientan los cartones**, que vuelan
   al saldo. El monto lo decide el servidor.
6. Cinco viajes. Al vaciar la quinta bolsa: cámara lenta, lluvia grande de cartones,
   cartel del premio y revelación de los ganchos.
7. Vuelve al lobby con el saldo actualizado.

**Duración objetivo: 50–80 segundos.** Cinco viajes de ida y vuelta, entre 8 y 14
segundos cada uno.

> **Nota de diseño — cuándo salen los cartones.** Salen **al vaciar en la carretilla**,
> no al agarrar la bolsa. Si reventaran al agarrarla, el viaje de vuelta no serviría
> para nada y el juego se reduciría a tocar cinco puntos. Al agarrarla sí hay un
> **adelanto**: la bolsa tintinea, asoma un cartón por la boca y brilla — para que se
> lea que ahí adentro hay algo. Es reversible en una línea si se prefiere al revés.

### 2.2 La pantalla

Una sola vista fija. Nada se desplaza; **el escenario completo cabe de un vistazo**, y
eso es una decisión de diseño, no solo de rendimiento: el jugador ve las cinco bolsas
desde el primer segundo y **planifica su ruta**. Esa lectura es la mitad del juego.

```
┌────────────────────────────────────────┐
│  ▓▓▓▓▓▓   edificios / fondo   ▓▓▓▓▓▓   │
│ ══════════════ acera ═════════════════ │
│                                        │
│    🗑            🚧                     │
│                          🗑            │
│         ╔═══╗                          │
│         ║ 🛒║  carretilla    🚧         │
│         ╚═══╝            🗑            │
│   🗑                                    │
│              🚶 ciudadano               │
│        🚧              🗑               │
│ ══════════════ acera ═════════════════ │
│  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓   │
└────────────────────────────────────────┘
      El dedo presiona → el ciudadano camina hacia ahí
```

**Capas, de fondo a frente:**

| Capa | Contenido | Coste |
|---|---|---|
| 0 | Fondo de calle (asfalto, aceras, rayas, alcantarillas) | **1 sprite, pre-compuesto** |
| 1 | Decorado fijo: edificios, postes, semáforos, árboles | sprites estáticos, nunca se mueven |
| 2 | Sombras (ciudadano, bolsas, obstáculos, carretilla) | sprites con `alpha` |
| 3 | Obstáculos y carretilla | ~10 sprites |
| 4 | Bolsas (5) | 5 sprites |
| 5 | **Ciudadano** | 1 sprite animado |
| 6 | Partículas: cartones, polvo, moscas, brillos | `ParticleContainer` |
| 7 | HUD (DOM/React, fuera de Pixi) | 0 |

El orden de dibujo dentro de las capas 3-5 se **ordena por Y** en cada fotograma
(`zIndex = y`): es lo que hace que el ciudadano pase por detrás de un poste que está
más abajo y por delante de uno que está más arriba. Sin eso la vista 3/4 se rompe.

El HUD va en **React/DOM encima del canvas**, no dentro de Pixi.

### 2.3 Controles

**Presionar y caminar (point-and-go).** El ciudadano camina hacia el punto donde el
dedo está apoyado, y sigue caminando mientras se mantenga apoyado. Si el dedo se
arrastra, el destino se mueve con él.

Por qué así y no arrastrando al muñeco directamente:

- **El dedo nunca tapa al personaje.** Es el problema número uno del táctil, y aquí se
  elimina de raíz: presionas donde quieres ir, no encima de quien va.
- Funciona igual en una pantalla de 5" y en un monitor: no depende de dónde empezó el gesto.
- El ratón hace exactamente lo mismo, sin código aparte.
- Un toque corto (< 150 ms) también sirve: camina hasta ahí y se detiene solo.

Detalles:

- El ciudadano **acelera y frena**, no arranca a tope. Cuando el destino queda cerca,
  desacelera y se detiene sin pasarse.
- Se **gira hacia donde camina** con 8 direcciones.
- Al chocar con un obstáculo **se desliza a lo largo del borde** en vez de quedarse
  clavado. Sin esto, un cono te bloquea y se siente roto.
- Zona muerta de 6 px alrededor del personaje: presionar encima de él no lo hace vibrar.

### 2.4 Las bolsas y la carretilla

- **Exactamente 5 bolsas**, repartidas por el generador determinista (§4) en un patrón
  que garantiza distancias mínimas entre ellas y con la carretilla — nada de dos bolsas
  pegadas ni una encima de un obstáculo.
- La bolsa más lejana **nunca está a más de ~2,5 s de camino** de la carretilla: el
  juego premia la ruta, no la caminata.
- **Una bolsa a la vez.** No se pueden cargar dos. Es lo que da ritmo: cinco idas y
  cinco vueltas, cinco pagos.
- Cargando: el ciudadano camina un 15 % más lento, con la bolsa al hombro y la
  silueta cambiada. Se **nota** que lleva algo.
- Las bolsas **no se pueden perder**. Si el jugador la suelta (§2.5), se queda en el
  suelo y se puede recoger otra vez.
- **La carretilla se llena a la vista.** Cada bolsa vaciada deja un montón visible que
  crece. Al final está a rebosar. Es el marcador de progreso del juego y no hace falta
  ningún número en pantalla para leerlo.

### 2.5 Los obstáculos

Fijos: conos, escombros, un hueco en el asfalto, una tapa de alcantarilla abierta,
charcos, una moto mal estacionada. Móviles: un perro que cruza, un carro que pasa
por el borde de la calle.

**Nunca hacen perder ni dinero ni bolsas.** Al chocar cargando una bolsa:

- El ciudadano **tropieza y suelta la bolsa**, que rueda un poco por el suelo.
- Polvo, temblor de cámara, vibración del teléfono, un «¡uy!».
- La bolsa sigue ahí. Se recoge otra vez. **Se pierde tiempo, no dinero.**

La densidad de obstáculos **sube en el camino de vuelta a la carretilla**: ir cargando
es la parte difícil, y es lo que hace que vaciar la bolsa se sienta ganado.

---

## 3. Sensación de juego (game feel)

Esta sección es el corazón del proyecto. Un juego que hace exactamente lo mismo se
siente barato o se siente delicioso según estos detalles. **No son «pulido para el
final»: son requisitos de la Fase 3 y cada uno tiene criterio de aceptación.**

El bucle tiene **tres momentos** y cada uno pesa distinto: agarrar (ligero),
cargar (tensión) y **vaciar (el pago)**.

### 3.1 Agarrar la bolsa — ligero, 300 ms

| t (ms) | Qué pasa |
|---|---|
| 0 | Contacto. Micro-hitstop de **35 ms**: la mitad que el de vaciar, porque este no es el momento importante. |
| 0 | La bolsa da un salto corto y aterriza en el hombro con `easeOutBack`. |
| 0 | Sonido de bolsa plástica + un **tintineo** apagado: hay algo dentro. |
| 0 | `navigator.vibrate(12)` — apenas un toque. |
| 60 | **Un cartón asoma** por la boca de la bolsa y se queda ahí, visible durante todo el viaje. Es la promesa. |
| 60 | Tres o cuatro chispas doradas suben y se apagan. Nada más: la fiesta es en la carretilla. |
| 120 | El contorno de la **carretilla se enciende** suavemente. El juego te dice adónde ir sin una flecha ni un texto. |

### 3.2 Cargar — la tensión

- El ciudadano camina 15 % más lento y con un **balanceo** que no tiene sin carga.
- El **peso se ve**: se inclina levemente hacia el lado de la bolsa.
- Los cartones que asoman **tintinean con cada paso** (el mismo sonido, con el tono
  variando un poco cada vez para que no canse).
- Si el jugador va derecho a la carretilla sin tropezar, al llegar hay un **bonus visual**
  de racha: los cartones salen con un 20 % más de fuerza. No paga más — se siente más.

### 3.3 Vaciar en la carretilla — el pago

| t (ms) | Qué pasa |
|---|---|
| 0 | El ciudadano entra en la zona de la carretilla. **Hitstop de 70 ms**: el truco más barato y más efectivo que existe para que un impacto se sienta sólido. |
| 0 | Destello blanco de 1 fotograma sobre toda la pantalla (`alpha` 0,35). |
| 0 | `navigator.vibrate(25)` — vibración corta y seca. |
| 0 | Sonido: nota de una **escala pentatónica ascendente**. Entrega 1 = Do, 2 = Re, 3 = Mi, 4 = Sol, 5 = La. Sube con cada bolsa: el oído entiende que estás progresando aunque nadie se lo diga. |
| 70 | El ciudadano **voltea la bolsa** sobre la carretilla en un arco de 250 ms. |
| 90 | **Estallido de cartones:** 18–28 sprites salen en abanico desde la boca de la carretilla, con velocidad inicial aleatoria, rotación propia y gravedad. Caen y rebotan una vez en el borde. |
| 90 | Temblor de cámara suave (2 px, 180 ms) + zoom de golpe (1 → 1,04 → 1) en 220 ms, centrado en la carretilla. |
| 90 | Anillo de onda expansiva que se expande y se desvanece. |
| 250 | **El montón de la carretilla crece** un escalón, con un pequeño rebote. Progreso visible y permanente. |
| 400 | Los cartones dejan la gravedad y **vuelan al contador del HUD** con `easeInBack`, escalonados 40 ms entre uno y otro. |
| 400+ | El contador de saldo **sube con `damp`**, no de golpe, y da un pulso de escala con cada cartón que llega. El número termina exactamente en el monto real. |
| 900 | El ciudadano **camina un 4 % más rápido** que antes. Cinco entregas después, el final se mueve notablemente mejor que el principio. |

**Criterio de aceptación:** grabar la secuencia a 60 fps y verla cuadro a cuadro. Si
quitando el hitstop no se nota la diferencia, está mal implementado.

### 3.4 La quinta bolsa — el clímax

- Desde la cuarta entrega, la música sube de capa y el escenario se enciende un punto.
- Al vaciar la quinta: **cámara lenta a 0,35× durante 600 ms**, zoom hacia la carretilla,
  oscurecimiento suave de los bordes.
- Sale **el doble de cartones**, dorados, y la lluvia sigue cayendo durante 2 s.
- La carretilla queda **desbordada**, con cartones asomando por todos lados.
- El contador sube hasta el premio total con un redoble.
- Cartel del premio con la tipografía grande, y solo entonces se revelan los ganchos
  («en esa bolsa había $6») sobre las que quedaron sin recoger.

### 3.5 El ciudadano

- **Ciclo de caminata de 8 fotogramas** en 8 direcciones. Es el gasto de arte más
  grande del proyecto y el que más se nota: un muñeco que se desliza sin animar mata
  el juego entero.
- **Squash de aterrizaje** en cada paso (escala vertical 1 → 0,96 → 1). Casi invisible,
  imprescindible.
- **Sombra elíptica** desplazada bajo los pies — es lo que hace que la vista 3/4 se
  lea como 3D.
- **Polvo** en los pies al arrancar y al frenar en seco.
- Si el jugador lo deja quieto 4 segundos, hace una **animación de reposo**: se estira,
  se seca la frente, mira alrededor. Cuesta poco y cambia por completo si el muñeco
  se siente vivo o es una calcomanía.

### 3.6 La cámara

- La cámara **no se desplaza** — la pantalla es fija. Pero **respira**: un zoom
  imperceptible (±1,5 %) y un desplazamiento de ±6 px que sigue con retraso al
  ciudadano. Una cámara absolutamente clavada se siente muerta.
- **Temblor** con caída exponencial, nunca lineal, y siempre con un tope: un temblor
  que no para marea.
- Al arrancar la partida, la cámara **entra desde un poco más lejos** y se acomoda
  en 900 ms mientras las bolsas aparecen escalonadas. Empezar en seco se siente barato.

### 3.7 Reglas transversales

- **Nada aparece ni desaparece de golpe.** Todo entra con escala/alfa en 120–250 ms.
- **Todo el movimiento pasa por un `damp` exponencial** con `delta` real, jamás por
  `+= constante`. Un `lerp` sin delta cambia de sensación según los fps.
- **Curvas de easing, nunca lineales.** `easeOutBack` para lo que aparece,
  `easeInBack` para lo que sale volando, `easeOutQuint` para la cámara.
- **Respeta `prefers-reduced-motion`:** sin temblor, sin cámara lenta, sin destellos.
  El juego sigue siendo jugable y sigue pagando igual.
- **El audio arranca solo tras el primer toque** (política de autoplay). Un botón
  de silencio siempre visible.

---

## 4. El mundo determinista (lo que se aprende de «Gusanito del Bosque»)

El juego del compañero (`distraete.com`) tiene una arquitectura que vale la pena
estudiar: un núcleo `sim.js` determinista que corre **idéntico** en el navegador, en un
arnés de Node y en una Edge Function de Deno que **re-simula las jugadas** para validar
la corrida. Para lograrlo prohíbe `Date`, `Math.random`, `performance.now` y hasta
`Math.sin`/`Math.cos` (usa polinomios propios, porque V8 y JSC no dan bit a bit lo mismo).
El render es **Canvas 2D puro sin framework**, con varios lienzos fuera de pantalla
pre-pintados, y habla con Supabase por `fetch` a pelo, sin SDK.

**Nosotros necesitamos la mitad de eso, y es importante entender por qué.**

Su juego es **de habilidad**: el ranking premia al que lo hace mejor, así que un cliente
modificado roba dinero real y la re-simulación completa es obligatoria. El nuestro tiene
el **premio sellado por RNG antes de empezar**; la habilidad no mueve un centavo. Un
tramposo que se teletransporte solo termina antes — y pagó su ticket igual.

Así que:

**Sí adoptamos:** generación del escenario desde una **semilla que emite el servidor**.
`/api/buy-ticket` devuelve `world_seed`, y `lib/game/world.ts` coloca con
`mulberry32(world_seed)` la carretilla, las 5 bolsas y todos los obstáculos dentro del
área jugable, respetando distancias mínimas. El servidor conoce la misma semilla y puede
recalcular el escenario, así que el cliente no puede inventarse bolsas de más.

Como la pantalla es fija, la colocación tiene reglas duras que el generador debe cumplir
(y que van con pruebas):

- Ninguna bolsa encima de un obstáculo ni a menos de 90 px de otra bolsa.
- Ninguna bolsa a menos de 140 px de la carretilla (si no, no hay viaje) ni a más de
  ~2,5 s de camino.
- Siempre existe una ruta libre entre cada bolsa y la carretilla. Se comprueba con una
  rejilla de ocupación y una inundación desde la carretilla: si alguna bolsa queda
  aislada, se resortea su posición.
- Las 5 bolsas repartidas en cuadrantes distintos del área, para que el recorrido use
  toda la pantalla.

**No adoptamos:** la traza de entradas, la re-simulación en Edge Function y la
aritmética a prueba de motores. Serían semanas de trabajo para blindar algo que no
tiene valor económico. *(Si algún día se añade un ranking con premio, esto vuelve
a la mesa y hay que rehacerlo.)*

**Sí adoptamos también:** su idea de servir el módulo del juego **sin framework**.
`lib/pixi/*` será TypeScript plano sin una sola importación de React. React monta el
canvas y le pasa callbacks; nada más. Eso mantiene el bucle de juego fuera del ciclo
de renderizado de React, que es de donde vienen los tirones.

---

## 5. Arquitectura

```
misCartones/
├── app/
│   ├── (main)/
│   │   ├── page.tsx              Lobby
│   │   ├── juego/page.tsx        Pantalla de juego
│   │   ├── billetera/ comprar/ perfil/ ranking/ referidos/
│   │   └── admin/                Panel (portado)
│   ├── api/
│   │   ├── buy-ticket/           Consume ticket, sella premio, emite world_seed
│   │   ├── deposit-bag/          ⭐ Reclamo atómico (ex try-key)
│   │   ├── session/              Reanudar partida en curso
│   │   ├── purchases/ wallet/ referrals/ ranking/ admin/ cron/
│   │   └── ...                   (portados de llaveMental)
│   └── auth/
├── components/
│   ├── game/
│   │   ├── GameCanvas.tsx        Client, next/dynamic ssr:false — monta y desmonta Pixi
│   │   ├── Hud.tsx               Saldo, entregas, silencio (DOM, no Pixi)
│   │   ├── PlayBar.tsx  WinModal.tsx
│   └── ...                       (payments, wallet, admin, chat — portados)
├── lib/
│   ├── game/
│   │   ├── rng.ts                ← portado sin cambios
│   │   ├── constants.ts          ← PAYOUT_TABLE intacta, TOTAL_BAGS = 5
│   │   ├── bagSplit.ts           ← ex prizeSplit.ts
│   │   ├── world.ts              ⭐ colocación determinista (cliente + servidor)
│   │   └── reveals.ts
│   ├── pixi/                     ⭐ El motor. TypeScript puro, cero React.
│   │   ├── engine.ts             Application, bucle de paso fijo, resize, letterbox
│   │   ├── assets.ts             Carga del atlas, barra de progreso
│   │   ├── stage/                escena fija: fondo, decorado, orden por Y
│   │   ├── entities/             citizen.ts  bag.ts  cart.ts  obstacle.ts
│   │   ├── move.ts               aceleración, frenado, deslizamiento por bordes
│   │   ├── fx/                   particles.ts  shake.ts  hitstop.ts  flash.ts
│   │   ├── input.ts              press-and-go (puntero unificado) + teclado
│   │   ├── camera.ts             respiración y temblor sobre pantalla fija
│   │   └── audio.ts              WebAudio, ducking, tintineo por paso
│   ├── payments/                 ← portado completo
│   ├── security/ supabase/ admin/ referrals/ wallet/
├── public/assets/
│   ├── atlas/                    Spritesheets WebP + .json
│   └── audio/                    Sprite de audio único
└── supabase/migrations/
```

### 5.1 La frontera React ↔ Pixi

`GameCanvas.tsx` es el único punto de contacto y hace **exactamente** cuatro cosas:

1. Crea el `<div>` contenedor y monta la `Application` de Pixi en `useEffect`.
2. Le entrega la configuración inicial (`session_id`, `world_seed`, calidad detectada).
3. Recibe callbacks del motor (`onBagDeposited`, `onFinished`) y los sube a React.
4. **Destruye la aplicación de Pixi en la limpieza del efecto**
   (`app.destroy(true, { children: true, texture: true })`). Si esto falla, cambiar de
   pantalla y volver duplica el contexto WebGL y el teléfono se muere. Es el bug número
   uno de integrar Pixi con React.

El motor **nunca** vuelve a renderizar React. El HUD se actualiza por un `store`
externo mínimo (`useSyncExternalStore`) para no re-renderizar el árbol a 60 fps.

### 5.2 Escenario fijo y pantallas distintas

El área de juego es un **rectángulo de tamaño lógico fijo** (por ejemplo 1080×1920 en
coordenadas de juego). El motor lo escala para llenar la pantalla real conservando la
proporción y rellenando los bordes con el decorado (nunca con barras negras). Así
`world.ts` coloca todo en coordenadas lógicas y el escenario es **idéntico en todos los
teléfonos** — que es también lo que permite que el servidor lo recalcule.

---

## 6. Servidor y economía

### 6.1 `POST /api/buy-ticket`

Idéntico al de llaveMental salvo por lo marcado.

1. Verificar sesión, admin, bloqueado.
2. ¿Partida activa? → devolver su estado completo (409), sin cobrar otro ticket.
3. ¿Tiene tickets? Si no → `NO_TICKETS`.
4. `drawPayoutTier()` + corta-rachas (2 consolaciones seguidas → `drawWinningTier()`).
5. ⭐ Generar `world_seed` con `crypto.getRandomValues`.
6. Insertar `game_runs` (cliente privilegiado).
7. `spend_ticket` (RPC atómico). Si falla → rollback de la sesión.
8. Responder `{ session_id, world_seed, bags_remaining: 5, tickets }`.
   **No se envía `target_payout` ni el reparto.**

### 6.2 `POST /api/deposit-bag` ⭐

El corazón. Réplica exacta del patrón de `try-key`. Se llama **al vaciar en la
carretilla**, nunca al agarrar la bolsa: agarrar es puramente visual y no toca el servidor.

```ts
// Literal de array de Postgres con el estado LEÍDO
const entregadasLiteral = `{${bagsDeposited.join(',')}}`;

// El UPDATE solo toca la fila si sigue ACTIVA y las bolsas entregadas son
// EXACTAMENTE las que leímos. Si otra petición llegó primero, devuelve []
// y esta petición NO acredita nada.
const reclamar = (campos) => admin
  .from('game_runs')
  .update(campos)
  .eq('id', session_id)
  .eq('player_id', user.id)
  .eq('game_status', 'ACTIVE')
  .eq('bags_deposited', entregadasLiteral)   // ← el cerrojo
  .select('id');
```

Flujo:

1. Validar `bag_id ∈ [0,4]` y que no esté ya en `bags_deposited`.
2. ⭐ **Guarda de ritmo:** rechazar si han pasado menos de 1.200 ms desde la entrega
   anterior (o desde el inicio, para la primera). Es el tiempo mínimo físicamente
   posible de un viaje. Un cliente con guion no gana dinero, pero sí puede martillar
   la API. Con el `rateLimit` de la BD por encima.
3. `reparto = bagSplit(target_payout, session_id)` — determinista, no se guarda nada.
4. `monto = reparto[bags_deposited.length]` — indexado por **orden de entrega**, no por
   `bag_id`. Así el jugador elige la ruta y el reparto sigue siendo el del servidor.
5. Reclamo atómico. Si pierde la carrera → `409 { race: true }`, sin pagar.
6. `credit_prize(player, monto)` (RPC atómico).
7. Si era la quinta: cerrar la corrida, insertar en `game_history`, evento `game_win`.
8. Responder `{ monto, bags_remaining, total_credited, finished }`.

### 6.3 Por qué el reparto no cambia el RTP

`bagSplit` reparte el premio ya sorteado en 5 partes que **suman exacto** el premio
(hay una red de seguridad al final que ajusta la mayor con el residuo). Como las 5
bolsas siempre se entregan, el jugador siempre cobra el 100 % de lo sorteado. El RTP
efectivo sigue siendo el de la tabla: **98,03 %**.

**Esto es lo que se rompería si los obstáculos castigaran, o si hubiera un reloj que
pudiera dejar bolsas sin entregar.** Queda escrito aquí para que nadie lo cambie más
adelante sin entender el precio.

---

## 7. Base de datos

Proyecto Supabase nuevo. Se **consolidan** las 34 migraciones de llaveMental en ~8
limpias, conservando cada invariante ganado a golpes. No se copian una por una: el
historial de llaveMental incluye idas y vueltas (la 004 borró un índice único que la
025 tuvo que reponer tras un cobro doble real) que no tiene sentido reproducir.

| # | Migración | Contenido |
|---|---|---|
| 001 | `base.sql` | `players` (cédula, whatsapp, rol, bloqueo, datos de cobro), `game_runs`, `game_history`, `app_events`, RLS, trigger `handle_new_user`. |
| 002 | `rpc_juego.sql` | `spend_ticket`, `credit_prize`, `is_admin`, `get_ranking`. |
| 003 | `pagos.sql` | `ticket_purchases`, `withdrawals`, `redeem_tickets`, `request_withdrawal`, `approve_purchase`, `reject_purchase`, `pay_withdrawal`, `cancel_withdrawal`, `save_payout_info`. |
| 004 | `integridad.sql` ⭐ | Los índices únicos de la 025. **Van desde el día uno**, no después del fraude. |
| 005 | `seguridad.sql` | `rate_limit_hits`, bloqueo de cuentas en los RPC de dinero, pausa de retiros 24 h tras recuperar clave, `blocked_references`. |
| 006 | `admin.sql` | Roles de staff, áreas del panel, `get_interaction_stats`, `get_admin_totals`, ajustes manuales, quién atendió. |
| 007 | `chat.sql` | Chat de soporte + realtime + respuestas rápidas + etiquetas. |
| 008 | `referidos.sql` | Códigos, `claim_referral` por tramos, `my_referrals`. |

### 7.1 `game_runs`

```sql
CREATE TABLE public.game_runs (
  id             UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_id      UUID NOT NULL REFERENCES public.players(id) ON DELETE CASCADE,
  target_payout  DECIMAL(10,2) NOT NULL,      -- sellado por el RNG
  world_seed     BIGINT NOT NULL,             -- coloca el escenario, cliente y servidor
  bags_deposited INT[] NOT NULL DEFAULT '{}', -- el cerrojo del reclamo atómico
  credited       DECIMAL(10,2) NOT NULL DEFAULT 0,
  game_status    TEXT NOT NULL DEFAULT 'ACTIVE'
                 CHECK (game_status IN ('ACTIVE','COMPLETED','EXPIRED')),
  last_bag_at    TIMESTAMPTZ,                 -- guarda de ritmo
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at   TIMESTAMPTZ
);

-- Una sola partida ACTIVA por jugador. Desde el día uno.
CREATE UNIQUE INDEX game_runs_una_activa
  ON public.game_runs (player_id) WHERE game_status = 'ACTIVE';
```

### 7.2 Índices desde el principio

Los tres de la 025 (partida activa única, compra en verificación única, movimiento del
banco único) más el compuesto de `app_events` de la 032. Y **sin** los dos índices
muertos que `paraoptimizar.md` recomienda borrar en llaveMental: aquí no se crean.

### 7.3 Cuenta bancaria

Decidir antes de la Fase 4: **cuenta receptora propia** para misCartones, o la misma
que llaveMental. Si es la misma, hay que añadir una discriminación por monto o por
referencia, porque `esCuentaNuestra()` solo distingue **cuentas**, no aplicaciones — dos
apps leyendo la misma cola de movimientos pueden reclamarse el pago la una a la otra.
Es exactamente el incidente del 10/08 al 14/08 documentado en `bankApi.ts`.
**Recomendación: cuenta propia.** Es la solución limpia y no cuesta código.

---

## 8. Rendimiento en gama baja

El objetivo es un Android de $80 con 2–3 GB de RAM. Presupuesto: **16,6 ms por
fotograma**, del que el juego debe usar menos de 8 ms.

**La pantalla fija cambia el problema por completo.** Sin scroll no hay mundo infinito,
ni aparición y destrucción de sprites, ni `TilingSprite` moviéndose, ni recolector de
basura trabajando en mitad de la partida. El escenario son **unos 25 sprites que se
crean una vez y no se destruyen nunca**. Esto es una holgura enorme y hay que gastarla
en las partículas y en el ciclo de caminata, no perderla.

| Técnica | Detalle |
|---|---|
| **Fondo pre-compuesto** | Asfalto, aceras, rayas y manchas se dibujan **una sola vez** a una `RenderTexture` al empezar la partida, y a partir de ahí el fondo entero es **un sprite**. Es la ventaja grande de no tener scroll. |
| **Un solo atlas** | Todo el arte en un spritesheet WebP de 2048×2048 o menos. Un atlas = una textura = las llamadas de dibujo se agrupan. |
| **`ParticleContainer` para cartones** | Es el contenedor que Pixi optimiza para miles de sprites de la misma textura. 300 cartones cuestan casi lo mismo que 10. |
| **Escena estática de verdad** | Los ~15 sprites de decorado no se tocan nunca: se les pone `cullable = false` y se dejan quietos. Solo se ordenan por Y los ~8 que sí se mueven. |
| **Pooling total** | Cero `new Sprite()` durante la partida. Todo se crea al cargar y se recicla. Un `new` en el bucle es una pausa del recolector de basura, y una pausa es un tirón visible. |
| **Paso fijo + interpolación** | El simulador corre a 60 Hz fijos con acumulador; el render interpola. La física no cambia si el teléfono baja a 45 fps. *(Es lo mismo que hace el juego del compañero.)* |
| **Tope de `devicePixelRatio`** | Máximo 2. En pantallas de 3× se dibuja a 2× y se estira: ahorra el 44 % de píxeles y no se nota. |
| **Pausa real en segundo plano** | Al ocultarse la pestaña se detiene el bucle **y el audio**. |
| **Degradación automática** | Si los fps medios caen por debajo de 45 durante 3 s: mitad de partículas, sin sombras suaves. Nunca se toca la nitidez ni se quitan elementos del juego — la misma lección que `lib/perf/calidad.ts`. |
| **Presupuesto de descarga** | Atlas + audio + código < 1,5 MB en la primera carga. Los jugadores están en datos móviles. El ciclo de caminata en 8 direcciones es lo que más pesa: se optimiza espejando las direcciones izquierda/derecha en vez de dibujarlas dos veces. |

**Criterio de aceptación de la Fase 1:** un dispositivo real de gama baja (no el
emulador) sostiene 60 fps durante 3 minutos seguidos sin que la temperatura haga bajar
los fps. Se mide con un contador de fps en modo dev, igual que hace `distraete.com`.

---

## 9. Arte y sonido

El personaje es el gasto principal y el que más se nota. El resto es decorado estático.

**Ciudadano** (lo más importante):

- Ciclo de caminata de **8 fotogramas × 8 direcciones** (4 dibujadas + 4 espejadas).
- El mismo ciclo en versión **cargando bolsa** (silueta distinta, balanceo).
- Agarrar (3 fotogramas), vaciar en la carretilla (4 fotogramas), tropezar (3),
  reposo (4-6, se repiten en bucle lento).

**Resto:**

- Bolsa de basura: en el suelo, brillando (cerca), al hombro, vaciándose, vacía.
- Carretilla: vacía y **5 estados de llenado** (uno por entrega) + desbordada al final.
- Cartón: 3-4 variantes de color + una dorada para la quinta entrega.
- Obstáculos: cono, escombros, hueco, alcantarilla, charco, moto. Perro y carro que pasan.
- Fondo: asfalto, aceras, rayas, alcantarillas, manchas (todo se compone una sola vez).
- Decorado: edificios, postes, semáforos, árboles, basureros, bancos.
- FX: polvo, chispa dorada, anillo de onda, brillo.

**Ruta recomendada:** prototipar con **Kenney.nl** (CC0, gratis; hay packs cenitales con
personajes animados) y encargar el set definitivo a un ilustrador cuando el juego ya se
sienta bien. Nunca al revés: el arte final sobre un juego que se siente mal solo hace un
juego bonito que se siente mal.

**Sonido:** un solo *sprite de audio* (un archivo con todos los efectos y marcas de
tiempo) para no abrir 15 conexiones. Pasos (dos variantes, alternando), bolsa plástica,
tintineo de cartones, tropiezo, vaciado, cinco notas de la escala, victoria, ambiente
urbano en bucle.

---

## 10. Fases de entrega

### Fase 0 — Andamiaje (2-3 días)

Next.js 16 + TypeScript + Tailwind. Proyecto Supabase nuevo, migraciones 001-002.
Auth (registro/login/recuperar) portado. Deploy en Vercel funcionando. PWA.
**Listo cuando:** un usuario se registra, entra y ve un lobby vacío en producción.

### Fase 1 — Prototipo gris jugable (4-6 días) ⭐ la fase que decide todo

Pixi v8 montado y desmontado limpiamente en React. Escenario fijo con escalado, un
círculo como ciudadano, cinco cuadrados como bolsas, un rectángulo como carretilla,
obstáculos, `press-and-go`, deslizamiento por bordes, agarrar y soltar, orden por Y.
**Sin arte, sin dinero, sin servidor.**
**Listo cuando:** se juega en un Android de gama baja real a 60 fps sostenidos durante
3 minutos, y **caminar hasta una bolsa y llevarla a la carretilla se siente bien**.
*Si aquí no se siente bien, no se sigue: se ajusta hasta que sí.*

### Fase 2 — Servidor y economía (3-4 días)

`rng.ts`, `constants.ts`, `bagSplit.ts`, `world.ts` portados, con las pruebas de
colocación (§4). `/api/buy-ticket` y `/api/deposit-bag` con reclamo atómico.
Migraciones 003-005. Tickets, saldo, partida reanudable.
**Listo cuando:** una simulación de 1 millón de partidas da RTP 98,0 % ± 0,1; una
ráfaga de 20 peticiones simultáneas a `/api/deposit-bag` con la misma bolsa acredita
**exactamente una vez**; y 10.000 escenarios generados al azar pasan las reglas de
colocación sin una sola bolsa aislada. Estas pruebas van al repositorio.

### Fase 3 — Sensación (5-7 días) ⭐ la fase que hace el juego

Todo el §3: ciclo de caminata, agarrar, cargar con balanceo, vaciar con hitstop y
estallido, carretilla que se llena, cámara lenta de la quinta, sonido, vibración,
contador animado, escala ascendente, reposo, polvo, sombras.
**Listo cuando:** cinco personas que no trabajan en el proyecto juegan tres partidas
seguidas sin que nadie se lo pida.

### Fase 4 — Pagos y OCR (3-4 días)

`lib/payments/*` portado. Cuenta bancaria propia configurada. Modal de compra, subida de
comprobante, validación automática, cron de revalidación.
**Listo cuando:** un pago móvil real se acredita solo en menos de 3 minutos.

### Fase 5 — Alrededores (4-5 días)

Panel admin por áreas, billetera y retiros, ranking, referidos por tramos, chat de
soporte, notificaciones.

### Fase 6 — Arte final y endurecimiento (4-6 días)

Sprites definitivos y ciclo de caminata final, atlas optimizado, auditoría de seguridad
completa, prueba de carga, revisión de índices.

**Total estimado: 5-7 semanas.** Las fases 1 y 3 son las que no se pueden apurar.

---

## 11. Riesgos

| Riesgo | Impacto | Mitigación |
|---|---|---|
| Fuga de contexto WebGL al navegar | El teléfono se congela tras 2-3 partidas | `app.destroy()` en la limpieza del efecto + prueba explícita de montar/desmontar 20 veces |
| El ciudadano se traba en un obstáculo | El jugador se siente impotente; abandona | Deslizamiento por el borde en vez de bloqueo, y prueba de colocación que garantiza ruta libre a cada bolsa |
| Caminar se siente lento o pesado | Cinco viajes se hacen eternos | Distancia máxima acotada (~2,5 s), aceleración generosa, y el personaje acelera 4 % por entrega |
| El ciclo de caminata se subestima | El muñeco se desliza sin animar y mata el juego | Es la partida de arte principal, presupuestada aparte y encargada en la Fase 6 con tiempo |
| El juego se siente «flojo» | Nadie mete un segundo ticket | La Fase 1 tiene puerta de calidad: no se avanza hasta que llevar una bolsa a la carretilla se sienta bien |
| Compartir cuenta bancaria con llaveMental | Un pago se acredita en el juego equivocado | Cuenta receptora propia (§7.3) |
| Copiar las 34 migraciones al pie de la letra | Se reproduce el hueco que causó el cobro doble | Consolidación en 8 migraciones con los índices únicos desde el día uno |
| El servicio de OCR (Railway) se cae | Los pagos no se leen solos | Ya degrada con gracia: la compra queda pendiente y se aprueba a mano. Sin cambios. |
| Alguien «mejora» el juego con un reloj o con obstáculos que castiguen | El RTP se rompe de forma no auditable | Documentado en §6.3 y en un comentario en `bagSplit.ts` |

---

## 12. Lo que hay que decidir antes de la Fase 4

1. ¿Cuenta bancaria receptora propia o compartida? (Recomendación: propia.)
2. ¿Mismo servicio de OCR en Railway o instancia aparte? (Puede compartirse: no tiene estado.)
3. ¿El ticket también cuesta $2? Si cambia, `spend_ticket` y toda la `PAYOUT_TABLE` hay
   que recalibrarlos — no es un número suelto.
4. ¿El mismo equipo de soporte atiende los dos paneles?
5. ¿Los cartones salen al **vaciar en la carretilla** (como está planteado) o al
   **agarrar la bolsa**? Ver la nota de diseño en §2.1.
