// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { createPrivacyService } from '../../privacy.js';
import { recordRecovery } from './recovery.server';

export const privacyService = () => createPrivacyService({ db, key: process.env.FULLBLEED_PRIVACY_KEY, recordRecovery });
