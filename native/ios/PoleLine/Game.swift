import SwiftUI
import AudioToolbox

@MainActor final class Game: ObservableObject {
    @Published var screen = "home"
    @Published var circuit: Circuit?
    @Published var drawing: Drawing?
    @Published var lap: Lap?
    @Published var ghost: Lap?
    @Published var tyre = 0
    @Published var elapsed = 0.0
    @Published var paused = false
    @Published var message = ""
    @Published var team = 0
    @Published var sound = true
    @Published var saved = false
    @Published var zoom = 1.0
    @Published var centre: CGPoint?
    let records = Records()
    let teams = ["Toyboxes scarlet", "Plum Comet", "Mint Motorworks", "Sunbeam Racing", "Bluebird Sport", "Coral Arrow"]
    let colors: [Color] = [Color(red:0.93,green:0.35,blue:0.30),.purple,.mint,.orange,.blue,.pink]
    let catalog: [CircuitSummary]
    private var lastFrame = Date()
    private let worker = DispatchQueue(label: "app.toyboxes.poleline.simulation",qos: .userInitiated)
    init() {
        catalog = (try? decode(PLCore.catalog())) ?? []
        team = records.team;sound = records.sound
    }
    func choose(_ index: Int) {
        guard screen != "loading" else { return }
        screen = "loading";lap = nil;drawing = nil;ghost = nil;centre = nil;zoom = 1
        worker.async {
            do {
                let selected: Circuit = try decode(PLCore.circuit(index))
                let drawing: Drawing = try decode(PLCore.touch(4,x:0,y:0))
                DispatchQueue.main.async {
                    self.circuit = selected;self.drawing = drawing;self.tyre = self.records.tyre(selected.id);self.screen = "draw"
                    if let record = self.records.best(selected.id) { self.loadGhost(record, circuit: index) }
                }
            } catch { DispatchQueue.main.async { self.message = "This circuit could not be prepared. Please try again.";self.screen = "home" } }
        }
    }
    private func loadGhost(_ record: Record,circuit: Int) {
        worker.async {
            let ghost: Lap? = try? decode(PLCore.race(circuit,coordinates:record.line.flatMap{$0}.map{NSNumber(value:$0)},tyre:record.tyre))
            DispatchQueue.main.async { if self.circuit?.index == circuit { self.ghost = ghost } }
        }
    }
    func touch(_ action: Int, _ point: CGPoint = .zero) {
        guard screen == "draw" else { return }
        let wasDone = drawing?.done ?? false
        if let updated: Drawing = try? decode(PLCore.touch(action,x:point.x,y:point.y)) {
            drawing = updated
            if updated.done && !wasDone { zoom = 1;centre = nil;beep() }
        }
    }
    func selectTyre(_ value: Int) { guard drawing?.points.isEmpty == true,let t = circuit else{return};tyre = value;records.setTyre(t.id,value) }
    func follow() { zoom = 2.4;if let p = drawing?.points.last ?? circuit?.points.first { centre = CGPoint(x:p[0],y:p[1]) } }
    func lift() { touch(2);if zoom>1.1 { follow() } }
    func race() {
        guard let t = circuit,let line = drawing?.points,drawing?.done == true else{return}
        screen = "loading"
        let compound = tyre
        worker.async {
            let text = PLCore.race(t.index,coordinates:line.flatMap{$0}.map{NSNumber(value:$0)},tyre:compound)
            DispatchQueue.main.async {
                if let lap: Lap = try? decode(text) { self.lap = lap;self.replay() }
                else { self.message = "This line could not be raced. Undo the last stroke and try again.";self.screen = "draw" }
            }
        }
    }
    func replay() { elapsed = 0;paused = false;lastFrame = Date();zoom = 1;centre = nil;screen = "race";beep() }
    func tick(_ now: Date) {
        guard screen == "race", let lap else { return }
        if !paused { elapsed += max(0,min(0.25,now.timeIntervalSince(lastFrame))) }
        lastFrame = now
        if elapsed >= Double(lap.timeMs)/1000 { finish() }
    }
    func togglePause() { paused.toggle();lastFrame = Date() }
    func finish() {
        guard let lap,let circuit,let line = drawing?.points else{return}
        elapsed = Double(lap.timeMs)/1000;saved = records.save(circuit.id,lap:lap,line:line);screen = "results";beep()
    }
    func again() { if saved { ghost = lap };lap = nil;screen = "draw";zoom = 1;centre = nil;touch(4) }
    func setTeam(_ value: Int) { team = value;records.team = value }
    func setSound(_ value: Bool) { sound = value;records.sound = value }
    func reset() { records.clear();team = 0;sound = true;screen = "home" }
    private func beep() { if sound { AudioServicesPlaySystemSound(1104) } }
}
