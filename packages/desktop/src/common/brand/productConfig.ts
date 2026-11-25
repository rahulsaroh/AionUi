/**
 * @license
 * Copyright 2026 Shiraj AI Agent
 * SPDX-License-Identifier: Apache-2.0
 */

export interface ProductConfig {
  productName: string;
  companyName: string;
  gumroadProductPermalink: string;
  gumroadVerifyUrl: string;
}

export const PRODUCT_CONFIG: ProductConfig = {
  productName: 'Shiraj AI Agent',
  companyName: 'Shiraj AI',
  gumroadProductPermalink: 'shiraj-ai-agent',
  gumroadVerifyUrl: 'https://api.gumroad.com/v2/licenses/verify',
};
