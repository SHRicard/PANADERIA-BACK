// Transformaciones de entrega: Cloudinary las aplica al pedir la URL y cachea el resultado.
// No agregan marca: la marca ya está grabada en la imagen desde que se subió.

const SEGMENTO_UPLOAD = '/image/upload/';
const SEGMENTO_VIDEO = '/video/upload/';

function esDeCloudinary(url: string, segmento = SEGMENTO_UPLOAD): boolean {
  try {
    const { hostname, pathname } = new URL(url);
    return hostname === 'res.cloudinary.com' && pathname.includes(segmento);
  } catch {
    return false;
  }
}

// https://res.cloudinary.com/<cloud>/image/upload/v123/carpeta/foto.jpg
//   → https://res.cloudinary.com/<cloud>/image/upload/<transformacion>/v123/carpeta/foto.jpg
function conTransformacion(url: string, transformacion: string): string {
  if (!esDeCloudinary(url)) return url;
  return url.replace(SEGMENTO_UPLOAD, `${SEGMENTO_UPLOAD}${transformacion}/`);
}

/** Versión chica para listas y grillas. Si la URL no es de Cloudinary, la devuelve igual */
export function urlMiniatura(url: string, ancho = 400): string {
  return conTransformacion(url, `w_${ancho},c_limit,q_auto,f_auto`);
}

/** La foto en su tamaño, en el formato y la calidad que mejor le vengan al navegador */
export function urlOptimizada(url: string): string {
  return conTransformacion(url, 'q_auto,f_auto');
}

/**
 * Un fotograma del video (el primero), chico y en .jpg: la miniatura de un video en las listas.
 * Cloudinary lo saca del video al pedir la URL: con la extensión .jpg devuelve una imagen
 */
export function urlPortadaDeVideo(url: string, ancho = 400): string {
  if (!esDeCloudinary(url, SEGMENTO_VIDEO)) return url;
  return url.replace(SEGMENTO_VIDEO, `${SEGMENTO_VIDEO}so_0,w_${ancho},c_limit,q_auto/`).replace(/\.\w+$/, '.jpg');
}
