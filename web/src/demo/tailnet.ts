import type { SignedInUser } from '@/lib/types';

const DEMO_LOGIN = 'camille.renard@example.com';
const DEMO_USER_PORTRAIT_URL = 'https://randomuser.me/api/portraits/women/44.jpg';

export const DEMO_USER: SignedInUser = {
  login: DEMO_LOGIN,
  name: 'Camille Renard',
  pictureUrl: DEMO_USER_PORTRAIT_URL,
  tailnet: 'bramble-koi.ts.net',
};
