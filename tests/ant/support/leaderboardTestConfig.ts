import { readFileSync } from 'node:fs';
import { readLeaderboardConfig } from '../../../assets/Colony/scripts/application/leaderboard/leaderboard';

export const leaderboardTestConfig = readLeaderboardConfig(JSON.parse(readFileSync(new URL('../../../assets/Colony/config/leaderboard.json', import.meta.url), 'utf8')));

import { readSocialConfig } from '../../../assets/Colony/scripts/application/social/social';
export const socialTestConfig = readSocialConfig(JSON.parse(readFileSync(new URL('../../../assets/Colony/config/social.json', import.meta.url), 'utf8')));
