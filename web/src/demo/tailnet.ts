import type { SignedInUser } from '@/lib/types';
import { avatarDataUri } from './avatar';

const DEMO_LOGIN = 'camille.renard@example.com';

export const DEMO_USER: SignedInUser = {
  login: DEMO_LOGIN,
  name: 'Camille Renard',
  pictureUrl: avatarDataUri(DEMO_LOGIN),
  tailnet: 'bramble-koi.ts.net',
};
