import io
import base64
import tempfile
import os
from pathlib import Path
from typing import Dict, Any
import numpy as np
import tifffile as tiff
from PIL import Image
import bin2cell as b2c

# global in-memory state
# stores generated tiles: TILES[overlay_id] = {zoom_level: {(x, y): tile_bytes}}
TILES = {}
DATASETS = {}  
IMAGE = {}     
SEGMENTATION = {}


def generate_tiles_from_image(pil_img: Image.Image, 
                              tile_size: int = 256, 
                              max_zoom: int = 4) -> Dict[int, Dict[tuple, bytes]]:
    """
    generate image tiles at multiple zoom levels (e.g. google maps)

    args:
        pil_img: PIL Image to tile
        tile_size: size of each tile (default 256x256)
        max_zoom: maximum zoom level (0 = most zoomed out)

    returns:
        dict mapping zoom_level -> {(x, y): tile_jpeg_bytes}
    """
    import sys
    tiles = {}

    print(f"Generating tiles from image {pil_img.size}", file=sys.stderr)

    # generate tiles for each zoom level
    for zoom in range(max_zoom + 1):
        scale = 2 ** (max_zoom - zoom)  # zoom 0 = smallest, max_zoom = full size
        scaled_width = pil_img.width // scale
        scaled_height = pil_img.height // scale

        # resize image for this zoom level
        scaled_img = pil_img.resize((scaled_width, scaled_height), Image.LANCZOS)

        tiles[zoom] = {}
        tile_count = 0

        # split into tiles
        for y in range(0, scaled_height, tile_size):
            for x in range(0, scaled_width, tile_size):
                # crop tile
                tile = scaled_img.crop((
                    x,
                    y,
                    min(x + tile_size, scaled_width),
                    min(y + tile_size, scaled_height)
                ))

                # save tile as JPEG
                buf = io.BytesIO()
                tile.save(buf, format='JPEG', quality=85, optimize=True)
                buf.seek(0)

                # store tile
                tile_x = x // tile_size
                tile_y = y // tile_size
                tiles[zoom][(tile_x, tile_y)] = buf.read()
                tile_count += 1

        print(f"  Zoom {zoom}: {scaled_width}x{scaled_height}, {tile_count} tiles", file=sys.stderr)

    return tiles


def plot_tissue_overlay(dataset_id: str,
                        img_id: str,
                        seg_id: str,
                        fill_key: str,
                        border_key: str = None) -> Dict[str, Any]:
    """
    plot gene expression or cluster labels on tissue with segmentation overlay using bin2cell

    args:
        dataset_id: ID of the loaded dataset
        img_id: ID of the loaded TIFF image
        seg_id: ID of the loaded segmentation NPZ
        fill_key: column name in adata.obs (cluster) or gene name
        border_key: optional column for cell borders

    returns:
        dict containing metadata:
        - overlay_id: unique identifier for this overlay
        - width/height: full image dimensions
        - tile_size: 256
        - max_zoom: 4
        - fill_key: what was visualized
        - is_gene: whether fill_key is a gene or cluster column
    """
    try:
        if dataset_id not in DATASETS:
            raise ValueError(f'Dataset {dataset_id} not found')

        if img_id not in IMAGE:
            raise ValueError(f'Image {img_id} not found. Please load TIFF file first.')

        if seg_id not in SEGMENTATION:
            raise ValueError(f'Segmentation {seg_id} not found. Please load NPZ file first.')

        adata = DATASETS[dataset_id]
        image_data = IMAGE[img_id]
        seg_data = SEGMENTATION[seg_id]

        # check if fill_key is a gene or a column in obs
        is_gene = fill_key in adata.var_names
        is_obs_col = fill_key in adata.obs.columns

        if not is_gene and not is_obs_col:
            raise ValueError(f'{fill_key} not found in genes or observation columns')

        # create temporary directory for bin2cell outputs
        with tempfile.TemporaryDirectory() as tmpdir:
            # debug: check input data
            import sys
            print(f"\n=== DEBUG: plot_tissue_overlay ===", file=sys.stderr)
            print(f"Dataset ID: {dataset_id}", file=sys.stderr)
            print(f"Image ID: {img_id}", file=sys.stderr)
            print(f"Seg ID: {seg_id}", file=sys.stderr)
            print(f"Fill key: {fill_key}", file=sys.stderr)
            print(f"Is gene: {is_gene}, Is obs col: {is_obs_col}", file=sys.stderr)
            print(f"Image data shape: {image_data.shape}, dtype: {image_data.dtype}", file=sys.stderr)
            print(f"Segmentation files: {seg_data.files}", file=sys.stderr)
            print(f"AnnData shape: {adata.shape}", file=sys.stderr)

            # save image temporarily
            temp_img_path = os.path.join(tmpdir, 'temp_image.tif')
            tiff.imwrite(temp_img_path, image_data)
            print(f"Saved temp TIFF to: {temp_img_path}", file=sys.stderr)

            # save segmentation temporarily
            temp_seg_path = os.path.join(tmpdir, 'temp_seg.npz')
            np.savez(temp_seg_path, **{k: seg_data[k] for k in seg_data.files})
            print(f"Saved temp NPZ to: {temp_seg_path}", file=sys.stderr)

            # use bin2cell to generate the visualization
            print(f"Calling bin2cell.view_cell_labels...", file=sys.stderr)
            img, legends = b2c.view_cell_labels(
                image_path=temp_img_path,
                labels_npz_path=temp_seg_path,
                cdata=adata,
                fill_key=fill_key,
                border_key=border_key
            )
            print(f"bin2cell returned successfully", file=sys.stderr)

            # close any matplotlib figures in legends to prevent serialization issues
            if legends:
                import matplotlib.pyplot as plt
                plt.close('all')

            # debug: check image properties
            print(f"Image shape: {img.shape}, dtype: {img.dtype}, min: {img.min()}, max: {img.max()}", file=sys.stderr)
            if len(img.shape) == 3:
                print(f"Image channels: {img.shape[2]}", file=sys.stderr)
            print(f"Unique values in image: {len(np.unique(img))}", file=sys.stderr)

            # convert image to base64
            # bin2cell returns RGB or RGBA images
            # ensure the image is in the correct format (uint8)
            if img.dtype != np.uint8:
                # normalize to 0-255 if needed
                if img.max() <= 1.0:
                    print(f"Converting from float [0,1] to uint8 [0,255]", file=sys.stderr)
                    img = (img * 255).astype(np.uint8)
                else:
                    print(f"Converting to uint8 without scaling", file=sys.stderr)
                    img = img.astype(np.uint8)
            else:
                print(f"Image already uint8", file=sys.stderr)

            buf = io.BytesIO()
            pil_img = Image.fromarray(img)
            print(f"PIL Image mode: {pil_img.mode}, size: {pil_img.size}", file=sys.stderr)

            # Generate tiles from the image
            print(f"Generating tiles for tissue overlay...", file=sys.stderr)
            tiles = generate_tiles_from_image(pil_img, tile_size=256, max_zoom=4)

            # Create unique overlay ID
            overlay_id = f"{dataset_id}:{img_id}:{seg_id}:{fill_key}"

            # Store tiles in memory
            TILES[overlay_id] = {
                'tiles': tiles,
                'width': pil_img.width,
                'height': pil_img.height,
                'tile_size': 256,
                'max_zoom': 4,
                'fill_key': fill_key,
                'is_gene': is_gene
            }

            print(f"Stored tiles for overlay_id: {overlay_id}", file=sys.stderr)
            print(f"=== END DEBUG ===\n", file=sys.stderr)

            result = {
                'overlay_id': overlay_id,
                'width': pil_img.width,
                'height': pil_img.height,
                'tile_size': 256,
                'max_zoom': 4,
                'fill_key': fill_key,
                'is_gene': is_gene
            }

            return result

    except Exception as e:
        import traceback
        traceback.print_exc()
        raise RuntimeError(f'Failed to generate tissue overlay: {str(e)}')


def get_tissue_overlay_tile(overlay_id: str,
                            zoom: int,
                            x: int,
                            y: int) -> Dict[str, Any]:
    """
    get a specific tile for a tissue overlay

    this is called repeatedly by the frontend as the user pans/zooms
    and serve only the tiles currently in the viewport

    args:
        overlay_id: ID of the overlay
        zoom: zoom level
        x: tile x coordinate
        y: tile y coordinate

    returns:
        dict containing base64 encoded JPEG tile
    """
    try:
        if overlay_id not in TILES:
            raise ValueError(f'Overlay {overlay_id} not found. Please generate overlay first.')

        overlay_data = TILES[overlay_id]
        tiles = overlay_data['tiles']

        if zoom not in tiles:
            raise ValueError(f'Zoom level {zoom} not found')

        if (x, y) not in tiles[zoom]:
            raise ValueError(f'Tile ({x}, {y}) not found at zoom {zoom}')

        tile_bytes = tiles[zoom][(x, y)]
        tile_base64 = base64.b64encode(tile_bytes).decode('utf-8')

        return {
            'tile': tile_base64,
            'format': 'jpeg'
        }

    except Exception as e:
        raise RuntimeError(f'Failed to get tile: {str(e)}')
