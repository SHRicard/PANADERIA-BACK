import { Schema, model } from 'mongoose';
import { urlMiniatura, urlPortadaDeVideo } from '../utils/cloudinaryUrl';

// La biblioteca de publicaciones del dueño: arma cada promo una vez (una foto o un video, con su texto) y después la
// comparte en su estado de WhatsApp las veces que quiera, sin tener el archivo guardado en el celular

export const TIPOS_PROMO = ['imagen', 'video'] as const;
export type TipoPromo = (typeof TIPOS_PROMO)[number];

export const LARGO_TITULO_PROMO = { min: 2, max: 60 };
export const TITULO_PROMO_INVALIDO = `El título tiene que tener entre ${LARGO_TITULO_PROMO.min} y ${LARGO_TITULO_PROMO.max} caracteres`;
export const MAX_TEXTO_PROMO = 500;
export const TEXTO_PROMO_INVALIDO = `El texto puede tener hasta ${MAX_TEXTO_PROMO} caracteres`;
/** Los videos son para el estado de WhatsApp: cortos */
export const MAX_SEGUNDOS_VIDEO = 15;

export interface IPromo {
  tipo: TipoPromo;
  titulo: string;
  /** Lo que acompaña la publicación en el estado */
  texto?: string;
  /** La foto (.jpg) o el video (.mp4) en Cloudinary, con la marca ya grabada: es lo que se descarga para compartir */
  archivoUrl: string;
  /** Interno: para borrarlo de Cloudinary */
  archivoPublicId: string;
  /** Solo los videos */
  duracionSegundos?: number;
  /** La última vez que el dueño tocó Compartir (si después terminó de publicar en WhatsApp, no se sabe) */
  ultimaPublicacion?: Date;
  vecesPublicada: number;
  createdAt: Date;
  updatedAt: Date;
}

const promoSchema = new Schema<IPromo>(
  {
    tipo: { type: String, enum: TIPOS_PROMO, required: true },
    titulo: {
      type: String,
      required: [true, 'Falta el título'],
      trim: true,
      minlength: [LARGO_TITULO_PROMO.min, TITULO_PROMO_INVALIDO],
      maxlength: [LARGO_TITULO_PROMO.max, TITULO_PROMO_INVALIDO],
    },
    texto: { type: String, trim: true, maxlength: [MAX_TEXTO_PROMO, TEXTO_PROMO_INVALIDO] },
    archivoUrl: { type: String, required: true },
    archivoPublicId: { type: String, required: true },
    duracionSegundos: {
      type: Number,
      min: 0,
      required: [function (this: IPromo) { return this.tipo === 'video'; }, 'Falta la duración del video'],
    },
    ultimaPublicacion: Date,
    vecesPublicada: { type: Number, default: 0, min: 0 },
  },
  {
    timestamps: true,
    // En todas las respuestas: sin archivoPublicId (es interno), con la URL para compartir y una miniatura .jpg
    // (en los videos, el primer fotograma)
    toJSON: {
      transform: (_doc, promo) => ({
        _id: promo._id,
        tipo: promo.tipo,
        titulo: promo.titulo,
        texto: promo.texto,
        url: promo.archivoUrl,
        miniatura: promo.tipo === 'video' ? urlPortadaDeVideo(promo.archivoUrl) : urlMiniatura(promo.archivoUrl),
        duracionSegundos: promo.duracionSegundos,
        vecesPublicada: promo.vecesPublicada,
        ultimaPublicacion: promo.ultimaPublicacion ?? null,
        createdAt: promo.createdAt,
        updatedAt: promo.updatedAt,
      }),
    },
  }
);

export const Promo = model<IPromo>('Promo', promoSchema);
