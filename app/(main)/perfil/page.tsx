'use client';

import ProfilePhotoPanel from '@/components/profile/ProfilePhotoPanel';

// Foto de perfil. Va sola: la lista de referidos tiene su propia pantalla y
// repetirla aquí hacía que «perfil» y «referidos» parecieran la misma cosa.
export default function PerfilPage() {
  return (
    <main>
      <ProfilePhotoPanel />
    </main>
  );
}
