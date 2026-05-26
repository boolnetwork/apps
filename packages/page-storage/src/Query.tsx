// Copyright 2017-2023 @polkadot/app-storage authors & contributors
// SPDX-License-Identifier: Apache-2.0

import type { ApiPromise } from '@polkadot/api';
import type { QueryableStorageEntry } from '@polkadot/api/types';
import type { ConstValue } from '@polkadot/react-components/InputConsts/types';
import type { Option, Raw } from '@polkadot/types';
import type { Codec, Registry } from '@polkadot/types/types';
import type { QueryTypes, StorageModuleQuery } from './types.js';

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Button, Labelled, styled } from '@polkadot/react-components';
import { useApi } from '@polkadot/react-hooks';
import valueToText from '@polkadot/react-params/valueToText';
import { getSiName } from '@polkadot/types/metadata/util';
import { unwrapStorageType } from '@polkadot/types/util';
import { compactStripLength, isCodec, isNull, isU8a, isUndefined, u8aToHex, u8aToString } from '@polkadot/util';

interface Props {
  className?: string;
  onRemove: (id: number) => void;
  value: QueryTypes;
}

function keyToName (isConst: boolean, _key: Uint8Array | QueryableStorageEntry<'promise'> | ConstValue): string {
  if (isConst) {
    const key = _key as ConstValue;

    return `const ${key.section}.${key.method}`;
  }

  const key = _key as Uint8Array | QueryableStorageEntry<'promise'>;

  if (isU8a(key)) {
    const [, u8a] = compactStripLength(key);

    return u8a[0] === 0x3a
      ? u8aToString(u8a)
      : u8aToHex(u8a);
  }

  return `${key.creator.section}.${key.creator.method}`;
}

function constTypeToString (registry: Registry, { meta }: ConstValue): string {
  return getSiName(registry, meta.type);
}

function queryTypeToString (registry: Registry, { creator: { meta: { modifier, type } } }: QueryableStorageEntry<'promise'>): string {
  const _type = unwrapStorageType(registry, type);

  return modifier.isOptional
    ? `Option<${_type}>`
    : _type;
}

function resolveStorageEntry (api: ApiPromise, key: QueryableStorageEntry<'promise'>): QueryableStorageEntry<'promise'> {
  const { method, section } = key.creator;
  const sectionApi = (api.query as Record<string, Record<string, QueryableStorageEntry<'promise'>>>)[section];

  return (sectionApi && sectionApi[method]) || key;
}

function setCodecState (setData: (v: Codec | undefined) => void, next: unknown): void {
  if (isUndefined(next) || isNull(next)) {
    setData(undefined);

    return;
  }

  if (!isCodec(next)) {
    setData(next as Codec);

    return;
  }

  try {
    setData(next.clone());
  } catch {
    setData(next);
  }
}

function ConstOutput ({ api, query }: { api: ApiPromise; query: QueryTypes & { isConst: true } }): React.ReactElement {
  const key = query.key as unknown as ConstValue;
  const typeStr = useMemo(
    () => constTypeToString(api.registry, key),
    [api.registry, key]
  );
  const sectionConsts = (api.consts as Record<string, Record<string, Codec>>)[key.section];
  const val = sectionConsts[key.method];

  return (
    <pre className='ui--output'>{valueToText(typeStr, val)}</pre>
  );
}

function RawStorageOutput ({ api, rawKey }: { api: ApiPromise; rawKey: Uint8Array }): React.ReactElement {
  const [data, setData] = useState<Option<Raw> | undefined>();
  const [flash, setFlash] = useState(false);
  const mountedRef = useRef(true);

  useEffect((): (() => void) | void => {
    mountedRef.current = true;
    let unsub: (() => void) | undefined;

    void api.isReady
      .then(async () => {
        try {
          unsub = await api.rpc.state.subscribeStorage(
            [[rawKey]],
            (maybeSet: unknown, maybeChanges?: unknown): void => {
              if (!mountedRef.current) {
                return;
              }

              const changes = (maybeChanges ?? maybeSet) as unknown;
              const first = Array.isArray(changes) ? changes[0] : changes;

              try {
                const opt = api.registry.createType('Option<Raw>', first) as Option<Raw>;

                setData(opt);
              } catch {
                setData(undefined);
              }

              setFlash(true);
              window.setTimeout(() => {
                mountedRef.current && setFlash(false);
              }, 1500);
            }
          );
        } catch (e) {
          console.error('subscribeStorage failed', e);
        }
      })
      .catch((e: Error) => console.error(e));

    return (): void => {
      mountedRef.current = false;
      unsub && unsub();
    };
  }, [api, rawKey]);

  return (
    <div className={`ui--output${flash ? ' rx--updated' : ''}`}>
      <pre>{valueToText('Raw', data as null)}</pre>
    </div>
  );
}

function ModuleStorageOutput ({ api, query }: { api: ApiPromise; query: StorageModuleQuery }): React.ReactElement {
  const [data, setData] = useState<Codec | undefined>();
  const [flash, setFlash] = useState(false);
  const mountedRef = useRef(true);

  const storageKey = useMemo(
    () => resolveStorageEntry(api, query.key as QueryableStorageEntry<'promise'>),
    [api, query.key]
  );
  const typeStr = useMemo(
    () => queryTypeToString(api.registry, storageKey),
    [api.registry, storageKey]
  );
  const argValues = useMemo(
    () => query.params.map(({ value }) => value),
    [query.params]
  );
  const argsKey = useMemo(
    () => query.params.map((p, i) => `${i}:${p.isValid}:${String(p.value)}`).join('|'),
    [query.params]
  );

  const { blockHash } = query;
  const metaType = storageKey.creator.meta.type;
  const allCount = metaType.isPlain
    ? 0
    : metaType.asMap.hashers.length;
  const isEntriesMode = argValues.length !== allCount;

  useEffect((): (() => void) | void => {
    mountedRef.current = true;
    let unsub: (() => void) | undefined;

    void api.isReady
      .then(async () => {
        if (!mountedRef.current) {
          return;
        }

        const sk = resolveStorageEntry(api, query.key as QueryableStorageEntry<'promise'>);

        try {
          if (blockHash) {
            const v = await sk.at(blockHash, ...argValues as []);

            mountedRef.current && setCodecState(setData, v);

            return;
          }

          if (isEntriesMode) {
            unsub = await (sk.entries as (...a: unknown[]) => Promise<() => void>)(
              ...argValues,
              (result: unknown): void => {
                if (!mountedRef.current) {
                  return;
                }

                setCodecState(setData, result);
                setFlash(true);
                window.setTimeout(() => mountedRef.current && setFlash(false), 1500);
              }
            );
          } else {
            // Some nodes under very fast block times do not reliably emit storage subscription updates.
            // Refresh on each new head (same cost order as a subscription) so the UI always tracks the chain.
            const pull = async (): Promise<void> => {
              if (!mountedRef.current) {
                return;
              }

              try {
                const v = allCount === 0
                  ? await (sk as () => Promise<unknown>)()
                  : await (sk as (...args: unknown[]) => Promise<unknown>)(...argValues);

                setCodecState(setData, v);
                setFlash(true);
                window.setTimeout(() => mountedRef.current && setFlash(false), 1500);
              } catch (err) {
                console.error('storage head pull failed', err);
              }
            };

            await pull();
            unsub = await api.rpc.chain.subscribeNewHeads(pull);
          }
        } catch (e) {
          console.error('storage subscribe failed', e);
        }
      })
      .catch((e: Error) => console.error(e));

    return (): void => {
      mountedRef.current = false;
      unsub && unsub();
    };
  }, [
    api,
    api.genesisHash.toHex(),
    blockHash,
    argsKey,
    isEntriesMode,
    allCount,
    query.key,
    storageKey.creator.section,
    storageKey.creator.method
  ]);

  return (
    <div className={`ui--output${flash ? ' rx--updated' : ''}`}>
      <pre>{valueToText(typeStr, data as null)}</pre>
    </div>
  );
}

function Query ({ className = '', onRemove, value }: Props): React.ReactElement<Props> | null {
  const { api } = useApi();

  const callName = useMemo(
    () => keyToName(value.isConst, value.key),
    [value.isConst, value.key]
  );
  const callType = useMemo(
    () =>
      value.isConst
        ? constTypeToString(api.registry, value.key as unknown as ConstValue)
        : isU8a(value.key)
          ? 'Raw'
          : queryTypeToString(
            api.registry,
            resolveStorageEntry(api, value.key as QueryableStorageEntry<'promise'>)
          ),
    [api.registry, value]
  );

  const _onRemove = useCallback(
    (): void => {
      onRemove(value.id);
    },
    [onRemove, value.id]
  );

  let body: React.ReactNode;

  if (value.isConst) {
    body = <ConstOutput api={api} query={value} />;
  } else if (isU8a(value.key)) {
    body = <RawStorageOutput api={api} rawKey={value.key} />;
  } else {
    body = <ModuleStorageOutput api={api} query={value as StorageModuleQuery} />;
  }

  return (
    <StyledDiv className={`${className} storage--Query storage--actionrow`}>
      <div className='storage--actionrow-value'>
        <Labelled
          label={
            <div className='storage--actionrow-label'>
              {callName}: {callType}
            </div>
          }
        >
          {body}
        </Labelled>
      </div>
      <div className='storage--actionrow-buttons'>
        <Button
          icon='times'
          key='close'
          onClick={_onRemove}
        />
      </div>
    </StyledDiv>
  );
}

const StyledDiv = styled.div`
  margin-bottom: 0.25em;

  label {
    text-transform: none !important;
  }

  .ui.disabled.dropdown.selection {
    color: #aaa;
    opacity: 1;
  }

  .ui--IdentityIcon {
    margin: -10px 0;
    vertical-align: middle;
  }

  pre {
    margin: 0;

    .ui--Param-text {
      overflow: hidden;
      text-overflow: ellipsis;
    }
  }

  .storage--actionrow-buttons {
    margin-top: -0.25rem;
  }
`;

export default React.memo(Query);
