// Copyright 2017-2023 @polkadot/react-signer authors & contributors
// SPDX-License-Identifier: Apache-2.0

import type { SignerOptions } from '@polkadot/api/submittable/types';

import React, { useCallback, useEffect, useState } from 'react';

import { InputNumber, Modal, Output } from '@polkadot/react-components';
import { useApi } from '@polkadot/react-hooks';
import { BN, BN_ZERO } from '@polkadot/util';

import { DEFAULT_NONCE_ERA_PERIOD, hasNonceEra, withNonceEra } from './nonceEra.js';
import { useTranslation } from './translate.js';

interface Props {
  address: string | null;
  className?: string;
  onChange: (signedOptions: Partial<SignerOptions>) => void;
  signedTx: string | null;
}

function SignFields ({ address, onChange, signedTx }: Props): React.ReactElement<Props> {
  const { api } = useApi();
  const [blocks, setBlocks] = useState(() => new BN(64));
  const [nonce, setNonce] = useState(BN_ZERO);
  const { t } = useTranslation();

  useEffect((): void => {
    if (hasNonceEra(api)) {
      api.rpc.chain
        .getHeader()
        .then(({ number }) => setBlocks(number.unwrap().addn(DEFAULT_NONCE_ERA_PERIOD)))
        .catch(console.error);
    }
  }, [api]);

  useEffect((): void => {
    address && api.derive.balances
      .account(address)
      .then(({ accountNonce }) => setNonce(accountNonce))
      .catch(console.error);
  }, [address, api]);

  useEffect((): void => {
    onChange(withNonceEra(api, { era: blocks.toNumber(), nonce }, blocks));
  }, [api, blocks, nonce, onChange]);

  const _setBlocks = useCallback(
    (blocks: BN = BN_ZERO) => setBlocks(blocks),
    []
  );

  const _setNonce = useCallback(
    (nonce: BN = BN_ZERO) => setNonce(nonce),
    []
  );

  return (
    <>
      <Modal.Columns hint={t('Override any applicable values for the specific signed output. These will be used to construct and display the signed transaction.')}>
        <InputNumber
          isDisabled={!!signedTx}
          isZeroable
          label={t<string>('Nonce')}
          labelExtra={t<string>('Current account nonce: {{accountNonce}}', { replace: { accountNonce: nonce } })}
          onChange={_setNonce}
          value={nonce}
        />
        <InputNumber
          isDisabled={!!signedTx}
          isZeroable
          label={hasNonceEra(api) ? t<string>('Valid until block') : t<string>('Lifetime (# of blocks)')}
          labelExtra={t<string>('Set to 0 to make transaction immortal')}
          onChange={_setBlocks}
          value={blocks}
        />
      </Modal.Columns>
      {!!signedTx && (
        <Modal.Columns hint={t('The actual fully constructed signed output. This can be used for submission via other channels.')}>
          <Output
            isFull
            isTrimmed
            label={t<string>('Signed transaction')}
            value={signedTx}
            withCopy
          />
        </Modal.Columns>
      )}
    </>
  );
}

export default React.memo(SignFields);
