// Copyright 2017-2023 @polkadot/react-signer authors & contributors
// SPDX-License-Identifier: Apache-2.0

import type { ApiPromise } from '@polkadot/api';
import type { SignerOptions } from '@polkadot/api/submittable/types';
import type { Signer } from '@polkadot/api/types';
import type { SignerPayloadJSON } from '@polkadot/types/types';
import type { BN } from '@polkadot/util';

import { u8aToHex } from '@polkadot/util';

interface NonceEraOptions extends Partial<SignerOptions> {
  nonceEra?: 'Immortal' | { Mortal: BN };
}

export const DEFAULT_NONCE_ERA_PERIOD = 2048;

export function hasNonceEra (api: ApiPromise): boolean {
  return api.registry.signedExtensions.includes('CheckNonceEra');
}

export function withNonceEra (api: ApiPromise, options: Partial<SignerOptions>, validUntil: BN): NonceEraOptions {
  return hasNonceEra(api)
    ? { ...options, era: 0, nonceEra: validUntil.isZero() ? 'Immortal' : { Mortal: validUntil } }
    : options;
}

export function withNonceEraSigner (api: ApiPromise, signer: Signer): Signer {
  const { signRaw } = signer;

  if (!hasNonceEra(api) || !signRaw) {
    return signer;
  }

  return {
    signPayload: async (payload: SignerPayloadJSON) => signRaw.call(signer, {
      address: payload.address,
      data: u8aToHex(
        api.registry
          .createType('ExtrinsicPayload', payload, { version: payload.version })
          .toU8a({ method: true })
      ),
      type: 'payload'
    }),
    update: signer.update?.bind(signer)
  };
}
