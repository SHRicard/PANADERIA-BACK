// Error esperado que tira un servicio (credenciales incorrectas, código vencido, no existe…).
// El manejador central de index.ts responde { error: mensaje } con este código, sin loguearlo.
export class ErrorHttp extends Error {
  readonly status: number;

  constructor(status: number, mensaje: string) {
    super(mensaje);
    this.name = 'ErrorHttp';
    this.status = status;
  }
}
