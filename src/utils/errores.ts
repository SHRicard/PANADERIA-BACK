// Error esperado que tira un servicio (credenciales incorrectas, código vencido, no existe…).
// El manejador central de index.ts responde { error: mensaje } con este código, sin loguear el stack:
// solo sale el mensaje en la línea de la petición (middleware/registro.ts).
export class ErrorHttp extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.status = status;
  }
}
