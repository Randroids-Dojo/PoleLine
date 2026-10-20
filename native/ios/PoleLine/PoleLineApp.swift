import SwiftUI
import Combine

@main struct PoleLineApp: App {
    var body: some Scene { WindowGroup { ContentView() } }
}
struct ContentView: View {
    @StateObject private var game = Game()
    @State private var settings = false
    @State private var leaving = false
    @Environment(\.scenePhase) private var phase
    private let ink = Color(red:0.10,green:0.19,blue:0.32)
    private let paper = Color(red:0.97,green:0.96,blue:0.91)
    private let timer = Timer.publish(every:1.0/30,on:.main,in:.common).autoconnect()
    var body: some View {
        mainContent
            .foregroundStyle(ink).background(paper).tint(ink)
            .buttonStyle(.bordered).controlSize(.large)
            .sheet(isPresented:$settings) { SettingsView(game:game) }
            .confirmationDialog("Leave this drawing?",isPresented:$leaving,titleVisibility:.visible) {
                Button("Leave drawing",role:.destructive) { game.screen = "home" }
                Button("Keep drawing",role:.cancel) { }
            } message: { Text("Your personal bests stay saved. This unfinished drawing will be cleared.") }
            .onReceive(timer) { game.tick($0) }
            .onChange(of:phase) { _,value in if value != .active { game.paused = true } }
            .onChange(of:game.screen) { _,value in UIApplication.shared.isIdleTimerDisabled = value == "draw" || value == "race" }
    }
    @ViewBuilder private var mainContent: some View {
            if game.screen == "home" { home }
            else if game.screen == "loading" { ProgressView("Preparing your circuit...").frame(maxWidth:.infinity,maxHeight:.infinity) }
            else if let track = game.circuit {
                VStack(spacing:8) {
                    HStack {
                        Button("Circuits") { if game.screen == "draw" && !(game.drawing?.points.isEmpty ?? true) { leaving = true } else { game.screen = "home" } }
                        Spacer();Text(track.name).font(.title2.bold());Spacer()
                        Button { settings = true } label: { Image(systemName:"gearshape") }.accessibilityLabel("Settings")
                    }
                    GeometryReader { size in
                        if size.size.width > size.size.height*1.3 {
                            HStack(spacing:16) { TrackCanvas(game:game,track:track);ScrollView { controls(track) }.frame(width:min(340,size.size.width*0.42)) }
                        } else { VStack(spacing:8) { TrackCanvas(game:game,track:track);controls(track) } }
                    }
                }.padding(16)
            }
    }
    private var home: some View {
        VStack(alignment:.leading,spacing:12) {
            Text("TOYBOXES").font(.caption.bold()).tracking(2)
            HStack { Text("PoleLine").font(.system(size:42,weight:.heavy,design:.rounded));Spacer();Button("Settings") { settings = true } }
            Text("Draw the lap. Find your flow.").font(.title3)
            Text("25 fictional circuits. All yours, all offline.").font(.subheadline)
            ScrollView {
                LazyVStack(spacing:10) {
                    ForEach(game.catalog) { track in
                        Button { game.choose(track.index) } label: {
                            VStack(alignment:.leading,spacing:6) {
                                HStack {
                                    Text(track.index == 0 ? "Start here: \(track.name)" : String(format:"%02d  %@",track.index,track.name)).font(.headline)
                                    Spacer();Image(systemName:"arrow.right")
                                }
                                if let best = game.records.best(track.id) { Text("Best \(lapTime(best.timeMs))").monospacedDigit() }
                                else { Text(track.character).font(.subheadline) }
                            }.frame(maxWidth:.infinity,alignment:.leading).padding(8)
                        }.buttonStyle(.bordered).accessibilityIdentifier("circuit-\(track.index)")
                    }
                }
            }
            Text("No account. No ads. No connection needed.").font(.caption)
            if !game.message.isEmpty { Text(game.message).font(.caption).accessibilityAddTraits(.updatesFrequently) }
        }.padding(20)
    }
    @ViewBuilder private func controls(_ track: Circuit) -> some View {
        if game.screen == "draw" {
            VStack(spacing:8) {
                Text("\(track.region)  ·  \(track.length/1000,specifier:"%.1f") km  ·  Track \(track.temperature) C").font(.caption)
                Text("\(Int((game.drawing?.progress ?? 0)*100))%  \(game.drawing?.message ?? "Start at the flag")").font(.subheadline).frame(maxWidth:.infinity,alignment:.leading).accessibilityIdentifier("drawingStatus")
                HStack { Button("Undo") { game.touch(3) };Button("Clear") { game.touch(4);game.zoom = 1;game.centre = nil };Button("Zoom / tip") { game.follow() } }
                Button("Overview") { game.zoom = 1;game.centre = nil }.font(.caption)
                Picker("Tyres",selection:Binding(get:{game.tyre},set:{game.selectTyre($0)})) {
                    Text("Soft").tag(0);Text("Medium").tag(1);Text("Hard").tag(2)
                }.pickerStyle(.segmented).disabled(!(game.drawing?.points.isEmpty ?? true)).accessibilityIdentifier("tyrePicker")
                Button("Race your line") { game.race() }.buttonStyle(.borderedProminent).tint(Color(red:1,green:0.83,blue:0.34)).foregroundStyle(ink)
                    .disabled(game.drawing?.done != true).accessibilityIdentifier("raceLine")
            }
        } else if game.screen == "race",let lap = game.lap {
            let sample = lap.sample(game.elapsed).index
            VStack(spacing:10) {
                Text(lapTime(Int(game.elapsed*1000))).font(.system(size:30,weight:.bold,design:.monospaced)).accessibilityIdentifier("raceClock")
                Text("\(Int(lap.speed[sample]*3.6)) km/h  ·  Battery \(Int(lap.battery[sample]*100))%  ·  Tyres \(Int(lap.temperature[sample])) C").font(.caption)
                Text(game.paused ? "Paused. Your lap will wait" : game.ghost == nil ? "Your line, brought to life" : "Racing your personal best ghost").font(.subheadline)
                HStack { Button(game.paused ? "Resume" : "Pause") { game.togglePause() }.accessibilityIdentifier("pauseLap");Button("Finish lap") { game.finish() } }
            }
        } else if game.screen == "results",let lap = game.lap {
            VStack(spacing:8) {
                Text("\(track.medal(lap.timeMs)) lap").font(.headline)
                Text(lapTime(lap.timeMs)).font(.system(size:38,weight:.bold,design:.monospaced)).accessibilityIdentifier("resultTime")
                Text(game.saved ? "New personal best. Saved on this device." : "Personal best \(lapTime(game.records.best(track.id)?.timeMs ?? lap.timeMs))").font(.subheadline)
                HStack { ForEach(0..<3) { i in VStack { Text("S\(i+1)").font(.caption.bold());Text(lapTime(lap.sectors[i])).font(.caption.monospacedDigit()) } } }
                Text("Top speed \(Int(lap.topSpeed)) km/h  ·  Gold \(lapTime(track.gold))").font(.caption)
                Text(lap.timeMs<=track.gold ? "A flowing lap. Try another tyre to find the last fraction." : "Open the corner entry and aim for a smoother exit.").font(.subheadline)
                HStack { Button("Draw again") { game.again() };Button("Replay") { game.replay() };Button("Circuits") { game.screen = "home" } }
            }
        }
    }
}
struct SettingsView: View {
    @ObservedObject var game: Game
    @Environment(\.dismiss) private var dismiss
    @State private var reset = false
    var body: some View {
        NavigationStack {
            Form {
                Section("Your car") {
                    Picker("Fictional team",selection:Binding(get:{game.team},set:{game.setTeam($0)})) { ForEach(0..<game.teams.count,id:\.self) { i in Text(game.teams[i]).tag(i) } }
                    Toggle("Sound",isOn:Binding(get:{game.sound},set:{game.setSound($0)}))
                }
                Section("How to play") {
                    Text("Choose a circuit and tyre. Start at the chequered flag, then draw in the direction of the yellow arrows. Stay on the road. Lift any time and continue from the purple tip.")
                    Text("Pinch to zoom, or use Zoom / tip. Drag the grass to pan. Undo removes your last stroke. Close the loop and race your line.")
                    Text("Smooth corners carry more speed. Soft tyres warm quickly; medium and hard tyres handle hotter conditions. Earn medals and race your own best ghost.")
                }
                Section("Privacy and support") {
                    Text("PoleLine collects no data. No analytics, ads, accounts, in-app purchases or cloud saves. The game never connects to a server. Circuits, simulation and records work offline from the first launch.")
                    Text("Progress is stored on this device. Uninstalling removes it. Device backups are managed by iOS.")
                    Text("Support: support@toyboxes.app\nVersion 1.0.0 (1)\nCopyright 2026 Randroid LLC")
                    Link("Online privacy policy",destination:URL(string:"https://toyboxes.app/games/poleline/privacy/")!)
                }
                Section { Button("Delete all local records",role:.destructive) { reset = true } }
            }.navigationTitle("PoleLine by Toyboxes").toolbar { Button("Done") { dismiss() } }
            .confirmationDialog("Delete all local records and settings?",isPresented:$reset,titleVisibility:.visible) { Button("Delete records",role:.destructive) { game.reset();dismiss() } } message: { Text("This cannot be undone.") }
        }
    }
}
