import { NextResponse } from 'next/server';

// Identificador del despliegue que está sirviendo ahora mismo. La app
// lo lee al abrirse y lo vuelve a consultar cada tanto: si cambió, es
// que hay una versión nueva publicada (ver VersionReload).
// Las Route Handlers no se cachean por defecto; el no-store es para
// que tampoco lo guarde el navegador.
export function GET() {
  const id =
    process.env.VERCEL_DEPLOYMENT_ID ?? process.env.VERCEL_GIT_COMMIT_SHA ?? 'local';
  return NextResponse.json({ id }, { headers: { 'cache-control': 'no-store' } });
}
