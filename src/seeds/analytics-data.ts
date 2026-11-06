import type { EstadoReserva } from '../../contract/types.js';
import {
  diaDeSemana,
  diaEnZona,
  instanteEnZona,
  sumarDias,
} from '../common/dates/dates.js';

const HORA_MS = 60 * 60_000;

export interface EspacioAnalitico {
  id: string;
  capacidad: number;
  activo: boolean;
}

export interface FijaAnalitica {
  espacioId: string;
  dia: number;
  inicio: string;
  fin: string;
  desde: string;
  hasta: string | null;
  activa: boolean;
}

export interface BloqueoAnalitico {
  espacioId: string;
  fecha: string;
  inicio: string | null;
  fin: string | null;
}

export interface ReservaExistenteAnalitica {
  espacioId: string;
  fecha: string;
  inicio: string;
}

export interface TurnoFicticio {
  espacioId: string;
  capacidad: number;
  fecha: string;
  inicio: string;
  fin: string;
  estado: EstadoReserva;
  cantidadPersonas: number;
  creadaEn: Date;
  ingresoEn: Date | null;
  ocupacion: string | null;
}

interface OpcionesGenerador {
  ahora: Date;
  meses: number;
  cantidad: number;
  espacios: readonly EspacioAnalitico[];
  fijas: readonly FijaAnalitica[];
  bloqueos: readonly BloqueoAnalitico[];
  reservasExistentes: readonly ReservaExistenteAnalitica[];
  aleatorio?: () => number;
}

interface Candidato extends Omit<
  TurnoFicticio,
  'estado' | 'cantidadPersonas' | 'creadaEn' | 'ingresoEn' | 'ocupacion'
> {
  peso: number;
}

function restarMeses(dia: string, meses: number): string {
  const [anio, mes, numeroDia] = dia.split('-').map(Number);
  const inicioMes = new Date(Date.UTC(anio, mes - 1 - meses, 1));
  const ultimoDia = new Date(
    Date.UTC(inicioMes.getUTCFullYear(), inicioMes.getUTCMonth() + 1, 0),
  ).getUTCDate();
  inicioMes.setUTCDate(Math.min(numeroDia, ultimoDia));
  return inicioMes.toISOString().slice(0, 10);
}

export function fechaInicioAnalitica(ahora: Date, meses: number): string {
  return restarMeses(diaEnZona(ahora), meses);
}

function seSuperpone(
  inicio: string,
  fin: string,
  inicioOcupado: string,
  finOcupado: string,
): boolean {
  return inicio < finOcupado && fin > inicioOcupado;
}

function pesoDelTurno(fecha: string, hora: number): number {
  const dia = diaDeSemana(fecha);
  const pesoDia = dia === 0 || dia === 6 ? 2.2 : dia === 5 ? 1.5 : 1;
  const pesoHora = hora >= 18 && hora <= 21 ? 2.4 : hora < 12 ? 0.75 : 1;
  return pesoDia * pesoHora;
}

function pesoDeMuestreo(peso: number, aleatorio: () => number): number {
  const muestra = Math.max(Number.EPSILON, Math.min(1, aleatorio()));
  return -Math.log(muestra) / peso;
}

export function generarTurnosFicticios({
  ahora,
  meses,
  cantidad,
  espacios,
  fijas,
  bloqueos,
  reservasExistentes,
  aleatorio = Math.random,
}: OpcionesGenerador): TurnoFicticio[] {
  if (!Number.isInteger(meses) || meses < 1)
    throw new Error('La cantidad de meses debe ser un entero positivo.');
  if (!Number.isInteger(cantidad) || cantidad < 1)
    throw new Error('La cantidad de reservas debe ser un entero positivo.');

  const hoy = diaEnZona(ahora);
  const desde = fechaInicioAnalitica(ahora, meses);
  const ocupadas = new Set(
    reservasExistentes.map(
      (reserva) => `${reserva.espacioId}|${reserva.fecha}|${reserva.inicio}`,
    ),
  );
  const espaciosActivos = espacios.filter((espacio) => espacio.activo);
  const candidatos: Candidato[] = [];

  for (let fecha = desde; fecha < hoy; fecha = sumarDias(fecha, 1)) {
    const dia = diaDeSemana(fecha);
    for (const espacio of espaciosActivos) {
      for (let hora = 8; hora <= 23; hora++) {
        const inicio = `${String(hora).padStart(2, '0')}:00`;
        const fin = `${String(hora + 1).padStart(2, '0')}:00`;
        const ocupacion = `${espacio.id}|${fecha}|${inicio}`;
        if (ocupadas.has(ocupacion)) continue;

        const fija = fijas.some(
          (reserva) =>
            reserva.activa &&
            reserva.espacioId === espacio.id &&
            reserva.dia === dia &&
            reserva.desde <= fecha &&
            (reserva.hasta === null || fecha <= reserva.hasta) &&
            seSuperpone(inicio, fin, reserva.inicio, reserva.fin),
        );
        if (fija) continue;

        const bloqueado = bloqueos.some(
          (bloqueo) =>
            bloqueo.espacioId === espacio.id &&
            bloqueo.fecha === fecha &&
            (bloqueo.inicio === null ||
              bloqueo.fin === null ||
              seSuperpone(inicio, fin, bloqueo.inicio, bloqueo.fin)),
        );
        if (bloqueado) continue;

        candidatos.push({
          espacioId: espacio.id,
          capacidad: espacio.capacidad,
          fecha,
          inicio,
          fin,
          peso: pesoDelTurno(fecha, hora),
        });
      }
    }
  }

  if (cantidad > candidatos.length) {
    throw new Error(
      `Sólo hay ${candidatos.length} turnos históricos disponibles sin superposición; no se pueden generar ${cantidad}.`,
    );
  }

  const seleccionados = candidatos
    .map((candidato) => ({
      candidato,
      prioridad: pesoDeMuestreo(candidato.peso, aleatorio),
    }))
    .sort((a, b) => a.prioridad - b.prioridad)
    .slice(0, cantidad)
    .map(({ candidato }) => candidato);

  return seleccionados.map((candidato) => {
    const valorEstado = aleatorio();
    const estado: EstadoReserva =
      valorEstado < 0.78
        ? 'cumplida'
        : valorEstado < 0.9
          ? 'ausente'
          : 'cancelada';
    const inicioTurno = instanteEnZona(candidato.fecha, candidato.inicio);
    const diasAnticipacion = 1 + Math.floor(aleatorio() * 30);
    const creadaEn = new Date(
      inicioTurno.getTime() - diasAnticipacion * 24 * HORA_MS,
    );
    const ingresoEn =
      estado === 'cumplida'
        ? new Date(
            inicioTurno.getTime() - (5 + Math.floor(aleatorio() * 26)) * 60_000,
          )
        : null;

    return {
      espacioId: candidato.espacioId,
      capacidad: candidato.capacidad,
      fecha: candidato.fecha,
      inicio: candidato.inicio,
      fin: candidato.fin,
      estado,
      cantidadPersonas:
        1 + Math.floor(aleatorio() * Math.max(1, candidato.capacidad)),
      creadaEn,
      ingresoEn,
      ocupacion:
        estado === 'cancelada'
          ? null
          : `${candidato.espacioId}|${candidato.fecha}|${candidato.inicio}`,
    };
  });
}
