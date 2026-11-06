import {
  EnviadorPush,
  type MensajePush,
} from '../common/notifications/ports.js';

interface TicketExpo {
  status: string;
  details?: { error?: string };
}

const esTicketExpo = (valor: unknown): valor is TicketExpo => {
  if (!valor || typeof valor !== 'object' || !('status' in valor)) return false;
  return typeof valor.status === 'string';
};

export class EnviadorExpo extends EnviadorPush {
  /** `url` es la dirección de la API de push de Expo (`EXPO_PUSH_URL` en la configuración). */
  constructor(readonly url: string) {
    super();
  }

  async enviar(
    mensajes: MensajePush[],
  ): Promise<{ tokensInvalidos: string[] }> {
    const porToken = mensajes.flatMap((mensaje) =>
      mensaje.tokens.map((to) => ({
        to,
        title: mensaje.titulo,
        body: mensaje.cuerpo,
        data: mensaje.datos,
      })),
    );
    const tokensInvalidos = new Set<string>();

    for (let inicio = 0; inicio < porToken.length; inicio += 100) {
      const tanda = porToken.slice(inicio, inicio + 100);
      const respuesta = await fetch(this.url, {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Accept-Encoding': 'gzip, deflate',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tanda),
      });

      if (!respuesta.ok) {
        throw new Error(`Expo Push respondió HTTP ${respuesta.status}.`);
      }

      const cuerpo: unknown = await respuesta.json();
      const tickets =
        cuerpo && typeof cuerpo === 'object' && 'data' in cuerpo
          ? cuerpo.data
          : undefined;
      if (
        !Array.isArray(tickets) ||
        tickets.length !== tanda.length ||
        !tickets.every(esTicketExpo)
      ) {
        throw new Error('Expo Push devolvió una respuesta inválida.');
      }

      tickets.forEach((ticket, indice) => {
        if (
          ticket.status === 'error' &&
          ticket.details?.error === 'DeviceNotRegistered'
        )
          tokensInvalidos.add(tanda[indice].to);
      });
    }

    return { tokensInvalidos: [...tokensInvalidos] };
  }
}
