import { redirect } from 'next/navigation';

/**
 * No hay portada: la primera pantalla es el login, de una vez. Quien ya tiene
 * sesión ni llega aquí —el proxy lo manda al juego— y quien no, entra directo
 * a iniciar sesión. Antes había una pantalla con un solo botón que llevaba al
 * login: un toque de más antes de poder jugar.
 */
export default function Inicio() {
  redirect('/auth/login');
}
