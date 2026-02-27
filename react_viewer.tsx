import { useEffect, useRef, useState } from 'react';
import * as api from './api';

interface TiledImageViewerProps {
  overlayId: string;
  width: number;      // full image width (at maxZoom)
  height: number;     // full image height (at maxZoom)
  tileSize: number;   // 256px
  maxZoom: number;    // 4 (32x zoom range)
}

export function TiledImageViewer({
  overlayId,
  width,
  height,
  tileSize,
  maxZoom,
}: TiledImageViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(0); // 0 = most zoomed out, maxZoom = full resolution
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });

  // client-side tile cache
  // key format: "zoom-x-y" (e.g., "2-5-3")
  // value: data URI for the JPEG image
  const [tiles, setTiles] = useState<Map<string, string>>(new Map());

  // calculate dimensions at current zoom level
  // zoom 0: width/16, zoom 1: width/8, ..., zoom 4: width/1
  const scale = Math.pow(2, maxZoom - zoom);
  const currentWidth = width / scale;
  const currentHeight = height / scale;

  /**
   * load visible tiles effect
   * runs whenever zoom, offset, or dimensions change
   * calculates which tiles are visible in the viewport and requests missing ones
   */
  useEffect(() => {
    if (!containerRef.current) return;

    const loadVisibleTiles = async () => {
      const container = containerRef.current!;
      const containerWidth = container.clientWidth;
      const containerHeight = container.clientHeight;

      // calculate which tiles are visible
      // startX/startY: first tile index in viewport
      // endX/endY: last tile index in viewport
      const startX = Math.max(0, Math.floor(-offset.x / tileSize));
      const startY = Math.max(0, Math.floor(-offset.y / tileSize));
      const endX = Math.min(
        Math.ceil(currentWidth / tileSize),
        Math.ceil((containerWidth - offset.x) / tileSize)
      );
      const endY = Math.min(
        Math.ceil(currentHeight / tileSize),
        Math.ceil((containerHeight - offset.y) / tileSize)
      );

      // load visible tiles that aren't already cached
      const newTiles = new Map(tiles);
      const promises: Promise<void>[] = [];

      for (let y = startY; y <= endY; y++) {
        for (let x = startX; x <= endX; x++) {
          const key = `${zoom}-${x}-${y}`;
          if (!newTiles.has(key)) {
            // request tile from backend
            promises.push(
              api.getTissueOverlayTile(overlayId, zoom, x, y)
                .then((result) => {
                  newTiles.set(key, `data:image/jpeg;base64,${result.tile}`);
                })
                .catch((err) => {
                  console.error(`Failed to load tile ${x},${y} at zoom ${zoom}:`, err);
                })
            );
          }
        }
      }

      // parallel loading: all tile requests happen concurrently, tiles are independent
      if (promises.length > 0) {
        await Promise.all(promises);
        setTiles(new Map(newTiles));
      }
    };

    loadVisibleTiles();
  }, [overlayId, zoom, offset, tileSize, currentWidth, currentHeight]);

  // zoom interaction handlers
  const handleWheel = (e: React.WheelEvent) => {
    e.preventDefault();

    if (e.deltaY < 0 && zoom < maxZoom) {
      setZoom(zoom + 1);
      setOffset({ x: offset.x * 2, y: offset.y * 2 });
    } else if (e.deltaY > 0 && zoom > 0) {
      // zoom out: halve the image size
      setZoom(zoom - 1);
      setOffset({ x: offset.x / 2, y: offset.y / 2 });
    }
  };

  const handleZoomIn = () => {
    if (zoom < maxZoom) {
      setZoom(zoom + 1);
      setOffset({ x: offset.x * 2, y: offset.y * 2 });
    }
  };

  const handleZoomOut = () => {
    if (zoom > 0) {
      setZoom(zoom - 1);
      setOffset({ x: offset.x / 2, y: offset.y / 2 });
    }
  };

  const handleReset = () => {
    setZoom(0);
    setOffset({ x: 0, y: 0 });
  };

  const handleMouseDown = (e: React.MouseEvent) => {
    setIsDragging(true);
    setDragStart({
      x: e.clientX - offset.x,
      y: e.clientY - offset.y,
    });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    setOffset({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };

  /**
   * render tiles
   * creates a positioned div for each tile in the current zoom level grid
   * tiles without loaded data show gray background, tiles with data show img
   */
  const renderTiles = () => {
    const tilesElements: JSX.Element[] = [];
    const tilesX = Math.ceil(currentWidth / tileSize);
    const tilesY = Math.ceil(currentHeight / tileSize);

    for (let y = 0; y < tilesY; y++) {
      for (let x = 0; x < tilesX; x++) {
        const key = `${zoom}-${x}-${y}`;
        const tileSrc = tiles.get(key);

        tilesElements.push(
          <div
            key={key}
            style={{
              position: 'absolute',
              left: x * tileSize,
              top: y * tileSize,
              width: tileSize,
              height: tileSize,
              backgroundColor: '#f0f0f0', 
            }}
          >
            {tileSrc && (
              <img
                src={tileSrc}
                alt={`Tile ${x},${y}`}
                style={{
                  width: '100%',
                  height: '100%',
                  display: 'block',
                }}
                draggable={false}
              />
            )}
          </div>
        );
      }
    }

    return tilesElements;
  };

  return (
    <div className="relative">
      {/* zoom controls */}
      <div className="absolute top-4 right-4 z-10 flex flex-col gap-2 bg-white rounded-lg shadow-lg p-2">
        <button
          onClick={handleZoomIn}
          disabled={zoom >= maxZoom}
          className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-bold disabled:opacity-50"
          title="Zoom In"
        >
          +
        </button>
        <button
          onClick={handleZoomOut}
          disabled={zoom <= 0}
          className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded text-gray-700 font-bold disabled:opacity-50"
          title="Zoom Out"
        >
          −
        </button>
        <button
          onClick={handleReset}
          className="w-8 h-8 flex items-center justify-center bg-gray-100 hover:bg-gray-200 rounded text-gray-700 text-xs"
          title="Reset"
        >
          ↺
        </button>
        <div className="text-xs text-center text-gray-600 mt-1">
          Zoom: {zoom}/{maxZoom}
        </div>
      </div>

      {/* tile container */}
      <div
        ref={containerRef}
        className="overflow-hidden bg-gray-100 rounded-lg"
        style={{
          cursor: isDragging ? 'grabbing' : 'grab',
          height: '900px',
        }}
        onWheel={handleWheel}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <div
          style={{
            position: 'relative',
            width: currentWidth,
            height: currentHeight,
            transform: `translate(${offset.x}px, ${offset.y}px)`,
            transition: isDragging ? 'none' : 'transform 0.1s',
          }}
        >
          {renderTiles()}
        </div>
      </div>

      <p className="mt-2 text-xs text-gray-500">
        Use mouse wheel to zoom, drag to pan. Tiles load on demand.
      </p>
    </div>
  );
}


/**
 * Example: GeneExpressionTab
 * 1. user selects gene from dropdown
 * 2. clicks "Load Tissue Overlay"
 * 3. handleShowTissueOverlay() calls backend to generate tiles
 * 4. backend returns metadata (overlay_id, dimensions)
 * 5. TiledImageViewer renders with that metadata
 * 6. TiledImageViewer requests tiles on-demand as user pans/zooms
 */

// simplified excerpt from GeneExpressionTab module
export function GeneExpressionTabExample() {
  const handleShowTissueOverlay = async (
    selectedGene: string,
    datasetId: string,
    tiffId: string,
    npzId: string
  ) => {

    const result = await api.plotTissueOverlay(datasetId, tiffId, npzId, selectedGene);

    // result contains:
    // {
    //   overlay_id: "dataset123:tissue456:seg789:GAPDH",
    //   width: 10000,
    //   height: 8000,
    //   tile_size: 256,
    //   max_zoom: 4
    // }

    // render TiledImageViewer with metadata
    return (
      <TiledImageViewer
        overlayId={result.overlay_id}
        width={result.width}
        height={result.height}
        tileSize={result.tile_size}
        maxZoom={result.max_zoom}
      />
    );
  };
}
