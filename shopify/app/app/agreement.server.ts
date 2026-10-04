// SPDX-License-Identifier: GPL-2.0-or-later
import db from './db.server';
import { createMerchantAgreement } from '../../merchant-agreement.js';

export const agreementService = createMerchantAgreement({ db });
