import { env } from './config';

async function rpc<T>(method: string, params: unknown): Promise<T> {
  const res = await fetch(env.rpcUrl, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: method, method, params }),
  });
  const json: any = await res.json();
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result as T;
}

export type DasAsset = {
  id: string;
  burnt?: boolean;
  ownership: { owner: string };
  compression?: { tree: string; leaf_id: number };
  content?: {
    json_uri?: string;
    metadata?: { name?: string; attributes?: { trait_type: string; value: string }[] };
  };
};

export const getAsset = (id: string) => rpc<DasAsset>('getAsset', { id });

export const getAssetsByOwner = async (owner: string) =>
  (await rpc<{ items: DasAsset[] }>('getAssetsByOwner', { ownerAddress: owner, page: 1, limit: 100 })).items;

export const attr = (a: DasAsset, key: string) =>
  a.content?.metadata?.attributes?.find((x) => x.trait_type === key)?.value;
