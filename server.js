const express = require("express");
const http = require("http");
const { Server } = require("socket.io");
const path = require("path");
const fs = require("fs");

const app = express();
const server = http.createServer(app);
const io = new Server(server);

app.use(express.static(path.join(__dirname, "public")));

let jugadores = [];
let buzzerActivo = false;
let primero = null;
let indicePreguntaActual = 0;
let respuestaBloqueada = false;
let juegoTerminado = false;

// Cargar preguntas
const preguntas = JSON.parse(fs.readFileSync("preguntas.json", "utf8"));

function obtenerPreguntaActual() {
    return preguntas[indicePreguntaActual];
}

function enviarPreguntaActual(socketDestino = io) {
    socketDestino.emit("mostrarPregunta", {
        ...obtenerPreguntaActual(),
        numero: indicePreguntaActual + 1,
        total: preguntas.length
    });
}

function enviarJugadores() {
    io.emit("actualizarJugadores", jugadores);
}

function obtenerTop3() {
    const ordenados = [...jugadores].sort((a, b) => b.puntos - a.puntos);
    return ordenados.slice(0, 3);
}

io.on("connection", (socket) => {
    console.log("Se conectó:", socket.id);

    // Registrar jugador
    socket.on("registrarJugador", (nombre) => {
        const existe = jugadores.find(j => j.id === socket.id);

        if (!existe) {
            jugadores.push({
                id: socket.id,
                nombre,
                puntos: 0
            });
        }

        enviarJugadores();
        enviarPreguntaActual(socket);

        if (juegoTerminado) {
            socket.emit("juegoTerminado", obtenerTop3());
        }
    });

    // Enviar pregunta actual al conectarse
    enviarPreguntaActual(socket);

    // Activar buzzer
    socket.on("activarBuzzer", () => {
        if (juegoTerminado) return;

        buzzerActivo = true;
        primero = null;
        respuestaBloqueada = false;

        io.emit("buzzerActivado");
        io.emit("estadoBuzzer", "Buzzer activado. Esperando jugador...");
    });

    // Reiniciar buzzer
    socket.on("reiniciarBuzzer", () => {
        if (juegoTerminado) return;

        buzzerActivo = false;
        primero = null;
        respuestaBloqueada = false;

        io.emit("buzzerReiniciado");
        io.emit("estadoBuzzer", "Buzzer reiniciado");
    });

    // Jugador presiona primero
    socket.on("buzz", () => {
        if (juegoTerminado) return;
        if (!buzzerActivo || primero || respuestaBloqueada) return;

        const jugador = jugadores.find(j => j.id === socket.id);
        if (!jugador) return;

        primero = jugador.id;
        buzzerActivo = false;

        io.emit("jugadorPrimero", jugador);
        io.emit("estadoBuzzer", `${jugador.nombre} presionó primero`);

        io.to(jugador.id).emit("puedeResponder");
        socket.broadcast.emit("otroJugadorRespondioPrimero", jugador.nombre);
    });

    // Responder opción
    socket.on("responderOpcion", (indiceOpcion) => {
        if (juegoTerminado) return;
        if (!primero) return;
        if (socket.id !== primero) return;
        if (respuestaBloqueada) return;

        respuestaBloqueada = true;

        const preguntaActual = obtenerPreguntaActual();
        const jugador = jugadores.find(j => j.id === socket.id);
        if (!jugador) return;

        const esCorrecta = indiceOpcion === preguntaActual.correcta;

        if (esCorrecta) {
            jugador.puntos += preguntaActual.puntos;
        } else {
            jugador.puntos -= 5;
        }

        io.emit("resultadoRespuesta", {
            jugador: jugador.nombre,
            opcionElegida: indiceOpcion,
            opcionCorrecta: preguntaActual.correcta,
            esCorrecta,
            puntosActuales: jugador.puntos
        });

        enviarJugadores();
    });

    // Siguiente pregunta
    socket.on("siguientePregunta", () => {
        if (juegoTerminado) return;

        indicePreguntaActual++;

        if (indicePreguntaActual >= preguntas.length) {
            indicePreguntaActual = 0;
        }

        buzzerActivo = false;
        primero = null;
        respuestaBloqueada = false;

        io.emit("buzzerReiniciado");
        io.emit("estadoBuzzer", "Nueva pregunta lista");
        enviarPreguntaActual();
    });

    // Reiniciar puntajes
    socket.on("reiniciarPuntajes", () => {
        jugadores.forEach(j => j.puntos = 0);

        buzzerActivo = false;
        primero = null;
        respuestaBloqueada = false;
        juegoTerminado = false;
        indicePreguntaActual = 0;

        enviarJugadores();
        io.emit("buzzerReiniciado");
        io.emit("estadoBuzzer", "Juego reiniciado");
        enviarPreguntaActual();
        io.emit("ocultarPantallaFinal");
    });

    // Terminar juego
    socket.on("terminarJuego", () => {
        juegoTerminado = true;
        buzzerActivo = false;
        primero = null;
        respuestaBloqueada = true;

        const top3 = obtenerTop3();

        io.emit("juegoTerminado", top3);
        io.emit("estadoBuzzer", "Juego terminado");
    });

    // Desconexión
    socket.on("disconnect", () => {
        jugadores = jugadores.filter(j => j.id !== socket.id);

        if (primero === socket.id) {
            primero = null;
            buzzerActivo = false;
            respuestaBloqueada = false;
            io.emit("buzzerReiniciado");
            io.emit("estadoBuzzer", "El jugador que iba a responder se desconectó");
        }

        enviarJugadores();
        console.log("Se desconectó:", socket.id);
    });
});
const PORT = process.env.PORT || 3000;

server.listen(PORT, () => {
    console.log("Servidor corriendo en puerto " + PORT);
});