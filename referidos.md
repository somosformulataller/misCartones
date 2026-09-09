# Sistema de referidos

**Fecha:** 09/09/2026 · **Estado: implementado, sin datos propios todavía**

> **Adaptado de `referidos.md` de La Llave Correcta.** La mecánica se portó
> tal cual. Lo que aquí se cita como medido —el embudo, la concentración de
> referidores, las fugas— es **de La Llave**, no de Mis Cartones: este juego
> no tiene todavía ningún referido. Se conserva porque explica **por qué el
> sistema está diseñado así** y dice de antemano dónde se va a caer la gente.

---

## Cómo funciona

Cada jugador tiene un **código** de 6 caracteres, que se le asigna al
registrarse (`nuevo_codigo_referido()`). Quien se registra con ese código
(`/auth/login?ref=CODIGO`) queda apuntado como su referido en
`players.referred_by`.

**Por cada 10 partidas** que juega el referido, quien lo invitó puede cobrar
**$1**, hasta un tope de **$3** a las 30 partidas.

| Partidas del referido | Lo que puede cobrar quien invitó |
|---|---|
| 0 – 9 | — |
| 10 | $1 |
| 20 | $2 |
| 30 o más | $3 (tope) |

El dinero **se suma al saldo**, no se paga aparte. Aquí no hay, como en La
Llave, la opción de mandarlo directo a un retiro: el premio de referido entra
en la billetera y de ahí sale como cualquier otro dólar.

### Dónde vive la verdad

**En el RPC `claim_referral(uuid)`** (migración 004, `SECURITY DEFINER`), no en
el cliente. Es importante: cualquiera puede llamar a los RPC desde la consola
del navegador, así que el cliente no puede decidir cuánto cobra.
`lib/referrals/constants.ts` tiene los mismos números **solo para pintarlos en
pantalla**; si cambias uno, cambia el otro.

Las partidas se cuentan como `COUNT(*)` sobre `game_history`. En La Llave hay
que usar `COUNT(DISTINCT session_id)` porque un exploit viejo de `try-key`
dejó filas duplicadas; **aquí no hace falta**, y no por suerte: el índice
único `game_history_run_unico` (migración 003) impide que una partida escriba
dos filas. La integridad la sostiene la base, no la consulta.

### Lo que impide que se abuse

Cuatro cosas, y las cuatro estaban ya en el juego hermano:

1. **Un candado por tramo.** El índice único `(referred_id, tramo)` en
   `referral_claims`: cada dólar de cada referido se cobra **una sola vez**,
   pase lo que pase. Aunque alguien pulse el botón diez veces seguidas.
2. **Nadie se refiere a sí mismo.** `handle_new_user` descarta el código si el
   referidor sería la misma cuenta que se está creando.
3. **Un código que no existe se ignora en silencio.** Nadie se queda sin
   cuenta por un enlace mal copiado.
4. **Freno de 24 h tras recuperar la contraseña.** `claim_referral` —igual que
   `request_withdrawal`— se niega durante las 24 horas siguientes a un cambio
   de contraseña. Si alguien entra en una cuenta ajena, no puede vaciarla
   antes de que su dueño se dé cuenta.

---

## Lo que La Llave aprendió en 17 días (04/09/2026)

Su sistema llevaba ~17 días vivo, con 1.846 usuarios:

| Métrica | Número | % |
|---|---:|---:|
| **Invitados** (se registraron con un código) | **182** | 9,9 % de los usuarios |
| **Referidores** (invitaron al menos a 1) | **85** | 4,6 % de los usuarios |
| Invitados que jugaron ≥ 1 partida | 97 | 53 % de los invitados |
| Invitados que llegaron a 30 partidas | 32 | 17,6 % de los invitados |

### El embudo, y dónde se cae la gente

```
182 invitados se registraron con un código
     │
     ▼  −47 %  nunca jugaron (85 personas)
 97 jugaron al menos una vez  (53 %)
     │
     ▼  −67 %  no llegaron a 30 partidas
 32 llegaron a la meta  (18 % del total)
```

**Las dos fugas grandes:**

1. **El 47 % de los invitados nunca jugó.** Se registran por el enlace y no
   arrancan.
2. **De los que sí jugaron, solo 1 de cada 3 llegó a las 30 partidas.**

La segunda fuga es la razón de que **aquí se pague por tramos desde el primer
día**. La Llave empezó con todo-o-nada —$3 de golpe a las 30 partidas— y tuvo
que cambiarlo el 07/09 precisamente por esto: una primera victoria a las 10
partidas sostiene el impulso mucho mejor que un único salto largo donde la
mayoría abandona.

### Quién invita: muy pocos, y muy concentrado

Solo el **4,6 %** de los usuarios ha invitado a alguien. Y dentro de ese 4,6 %:
una sola persona invitó a **29** (el 16 % de TODOS los invitados), y los tres
primeros juntaban el 24 %.

**La lectura:** el motor lo mueven un puñado de embajadores. La oportunidad no
está en exprimir más a esos pocos, sino en **despertar al 95 % que nunca ha
invitado** — y ese 95 % en su mayoría **ni sabe que el sistema existe**.

---

## Qué falta por hacer aquí

Ordenado por impacto esperado. Nada de esto está implementado todavía.

### Para que el sistema funcione mejor

1. **Premiar también al invitado (incentivo de doble lado) — la de mayor
   impacto.** Hoy solo gana quien invita; el amigo nuevo no recibe nada, así
   que no tiene ningún motivo para llegar a las 30 partidas. Darle algo —por
   ejemplo **1 ticket gratis al registrarse con código**— ataca de frente las
   **dos** fugas: el 47 % que no arranca y el 67 % que no llega.
   ⚠️ Antes de fijar el monto hay que mirarlo contra el RTP: un ticket regalado
   es $2 que salen sin haber entrado. Es una decisión de economía, no de
   producto.

2. **Avisar cuando se desbloquea un tramo.** *«Tu referido ya jugó 10
   partidas: puedes cobrar $1.»* Cierra el bucle de recompensa justo cuando
   más motiva. Aquí no hay chat ni notificaciones todavía, así que esto
   depende de construir uno de los dos.

3. **Mostrar el progreso del referido y facilitar el empujón.** En «Mis
   referidos», enseñar *«le faltan X partidas»* y un botón para escribirle por
   WhatsApp. Convierte al referidor en quien arrastra a su amigo hasta la meta.

4. **Auto-acreditar cada tramo** en vez del botón de cobrar. En La Llave se
   evaluó y **se decidió mantener el cobro manual**, para no tocar el camino
   caliente del juego ni las guardas antifraude. Queda como opción si el paso
   manual acaba dejando premios sin cobrar.

### Para que más gente lo use

1. **Hacerlo visible donde el jugador está ganando.** Un aviso justo después
   de una buena partida o de una compra: *«Gana $3 por cada amigo que
   traigas»*. El mejor momento para pedir que comparta es cuando acaba de
   tener una buena experiencia.

2. **Compartir por WhatsApp en un toque.** Venezuela vive en WhatsApp y ya
   tenemos su número. Botón con el mensaje y el enlace ya escritos. Cuanta
   menos fricción, más se comparte. (`lib/referrals/compartir.ts` ya está.)

3. **Dar al invitado un motivo para hacer clic.** Que el enlace prometa algo:
   *«Tu amigo te regala un ticket para empezar»*. Sube la tasa de registro **y**
   la de activación. Es la misma idea del punto 1 de arriba, vista desde fuera.

4. **Reconocer a los embajadores.** Pocos mueven casi todo. Un bono al llegar
   a 10 referidos, o una insignia de «top referidores», motiva a quien ya
   empuja.

5. **Pedir el primer «compartir» temprano.** En los primeros minutos del
   jugador nuevo —tras su primera partida—, enseñarle su código. Enganchar el
   hábito desde el día uno.

---

## Cómo repetir el análisis cuando haya datos

Todo sale de la base, con la clave de servicio:

- **Invitados:** `players.referred_by IS NOT NULL`.
- **Referidores:** `COUNT(DISTINCT referred_by)`.
- **Partidas por invitado:** `COUNT(*)` en `game_history` — el mismo criterio
  que usa `claim_referral`.
- **Premios pagados:** tabla `referral_claims`, una fila por cada $1.
- **Desbloqueados sin cobrar:** invitados con ≥10 partidas, menos los cobros.

El panel de administración ya trae el tablero hecho: pestaña **Referidos**,
que lo calcula todo con el RPC `admin_referral_overview` (migración 005) —
sobre la base entera, no sobre una consulta con límite. Usa la **misma
fórmula** que paga: `LEAST(3, (partidas / 10) * 1)`. Hay una prueba en
`npm test` que comprueba justamente eso, porque un tablero que cuenta distinto
a lo que paga es peor que no tener tablero.

---

## Referencias

- **La lógica del dinero:** RPC `claim_referral(uuid)` y `my_referrals()` en
  `supabase/migrations/004_cuentas_y_dinero.sql`. Tabla `referral_claims`, con
  el índice único `(referred_id, tramo)`.
- **El tablero del equipo:** `admin_referral_overview()` en la migración 005;
  ruta `app/api/admin/referrals/route.ts`.
- **En la app:** `app/(main)/referidos/page.tsx`,
  `app/api/referrals/claim/route.ts`, `lib/referrals/`.
- **Los referidos NO tocan el RTP.** El premio de cada partida lo decide el
  sorteo del juego; esto es dinero que sale aparte. Ver `rtp-propuesta.md`.
- **Cómo entra el dinero al sistema:** `nuevoPlanValidacionPagos.md` y
  `ocr.md`.
