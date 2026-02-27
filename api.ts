import { invoke } from '@tauri-apps/api/core';

export async function plotTissueOverlay(
  datasetId: string,
  imgId: string,
  segId: string,
  fillKey: string,
  borderKey?: string
): Promise<{
  overlay_id: string;
  width: number;
  height: number;
  tile_size: number;
  max_zoom: number;
  fill_key: string;
  is_gene: boolean;
}> {
  return await invoke('plot_tissue_overlay_cmd', {
    datasetId,
    imgId,
    segId,
    fillKey,
    borderKey
  });
}

export async function getTissueOverlayTile(
  overlayId: string,
  zoom: number,
  x: number,
  y: number
): Promise<{
  tile: string;
  format: string;
}> {
  return await invoke('get_tissue_overlay_tile_cmd', {
    overlayId,
    zoom,
    x,
    y
  });
}
