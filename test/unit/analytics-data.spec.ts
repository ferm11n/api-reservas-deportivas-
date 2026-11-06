import { diaEnZona, sumarDias } from '../../src/common/dates/dates.js';
import {
  fechaInicioAnalitica,
  generarTurnosFicticios,
} from '../../src/seeds/analytics-data.js';

describe('dataset ficticio de analítica', () => {
  const ahora = new Date('2026-11-05T16:00:00-03:00');
  const hoy = diaEnZona(ahora);
  const desde = fechaInicioAnalitica(ahora, 6);
  const fechaBloqueada = sumarDias(hoy, -10);

  const espacios = [
    { id: 'esp-01', capacidad: 12, activo: true },
    { id: 'esp-02', capacidad: 10, activo: true },
    { id: 'esp-inactivo', capacidad: 10, activo: false },
  ];

  it('genera turnos pasados únicos y respeta reservas, bloqueos y fijas', () => {
    const turnos = generarTurnosFicticios({
      ahora,
      meses: 6,
      cantidad: 100,
      espacios,
      fijas: [
        {
          espacioId: 'esp-01',
          dia: new Date(`${desde}T12:00:00Z`).getUTCDay(),
          inicio: '18:00',
          fin: '20:00',
          desde,
          hasta: null,
          activa: true,
        },
      ],
      bloqueos: [
        {
          espacioId: 'esp-01',
          fecha: fechaBloqueada,
          inicio: '10:00',
          fin: '12:00',
        },
        {
          espacioId: 'esp-02',
          fecha: fechaBloqueada,
          inicio: null,
          fin: null,
        },
      ],
      reservasExistentes: [
        {
          espacioId: 'esp-01',
          fecha: sumarDias(hoy, -1),
          inicio: '08:00',
        },
      ],
      aleatorio: () => 0.5,
    });

    expect(turnos).toHaveLength(100);
    expect(
      new Set(
        turnos.map(
          ({ espacioId, fecha, inicio }) => `${espacioId}|${fecha}|${inicio}`,
        ),
      ).size,
    ).toBe(100);
    expect(
      turnos.every((turno) => turno.fecha >= desde && turno.fecha < hoy),
    ).toBe(true);
    expect(turnos.every((turno) => turno.espacioId !== 'esp-inactivo')).toBe(
      true,
    );
    expect(
      turnos.every(
        (turno) =>
          turno.cantidadPersonas >= 1 &&
          turno.cantidadPersonas <= turno.capacidad,
      ),
    ).toBe(true);
    expect(
      turnos.some(
        (turno) =>
          turno.espacioId === 'esp-01' &&
          turno.fecha === sumarDias(hoy, -1) &&
          turno.inicio === '08:00',
      ),
    ).toBe(false);
    expect(
      turnos.some(
        (turno) =>
          turno.espacioId === 'esp-01' &&
          turno.fecha === fechaBloqueada &&
          turno.inicio >= '10:00' &&
          turno.inicio < '12:00',
      ),
    ).toBe(false);
    expect(
      turnos.some(
        (turno) =>
          turno.espacioId === 'esp-02' && turno.fecha === fechaBloqueada,
      ),
    ).toBe(false);
    expect(
      turnos.some(
        (turno) =>
          turno.espacioId === 'esp-01' &&
          new Date(`${turno.fecha}T12:00:00Z`).getUTCDay() ===
            new Date(`${desde}T12:00:00Z`).getUTCDay() &&
          turno.inicio >= '18:00' &&
          turno.inicio < '20:00',
      ),
    ).toBe(false);
  });

  it('falla explícitamente si se piden más turnos que los disponibles', () => {
    expect(() =>
      generarTurnosFicticios({
        ahora,
        meses: 1,
        cantidad: 10_000,
        espacios: [],
        fijas: [],
        bloqueos: [],
        reservasExistentes: [],
        aleatorio: () => 0.5,
      }),
    ).toThrow('no se pueden generar 10000');
  });
});
