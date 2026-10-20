import SwiftUI

struct TrackCanvas: View {
    @ObservedObject var game: Game
    let track: Circuit
    @State private var dragging = false
    @State private var panning = false
    @State private var panCentre: CGPoint?
    @State private var pinchStart = 1.0
    private var bounds: CGRect {
        let xs = track.points.map{$0[0]},ys = track.points.map{$0[1]}
        return CGRect(x:xs.min()!,y:ys.min()!,width:xs.max()!-xs.min()!,height:ys.max()!-ys.min()!)
    }
    private func scale(_ size: CGSize) -> Double { min((size.width-24)/(bounds.width+track.width*2),(size.height-32)/(bounds.height+track.width*2))*game.zoom }
    private func centre() -> CGPoint { game.centre ?? CGPoint(x:bounds.midX,y:bounds.midY) }
    private func screen(_ p: [Double], _ size: CGSize) -> CGPoint { let c = centre(),s = scale(size);return CGPoint(x:size.width/2+(p[0]-c.x)*s,y:size.height/2+(p[1]-c.y)*s) }
    private func world(_ p: CGPoint, _ size: CGSize) -> CGPoint { let c = centre(),s = scale(size);return CGPoint(x:(p.x-size.width/2)/s+c.x,y:(p.y-size.height/2)/s+c.y) }
    private func path(_ points: [[Double]], _ size: CGSize,closed: Bool = false) -> Path {
        Path { p in for (i,v) in points.enumerated() { if i == 0 { p.move(to:screen(v,size)) } else { p.addLine(to:screen(v,size)) } };if closed { p.closeSubpath() } }
    }
    var body: some View {
        GeometryReader { geometry in
            Canvas { context,size in
                context.fill(Path(CGRect(origin:.zero,size:size)),with:.color(track.night ? Color(red:0.10,green:0.19,blue:0.24) : Color(red:0.82,green:0.89,blue:0.78)))
                let road = path(track.points,size,closed:true),width = track.width*scale(size)
                context.stroke(road,with:.color(Color(red:0.94,green:0.44,blue:0.32)),style:StrokeStyle(lineWidth:width+9,lineCap:.round,lineJoin:.round))
                context.stroke(road,with:.color(Color(red:0.98,green:0.96,blue:0.88)),style:StrokeStyle(lineWidth:width+4,lineCap:.round,lineJoin:.round))
                context.stroke(road,with:.color(Color(red:0.24,green:0.30,blue:0.32)),style:StrokeStyle(lineWidth:width,lineCap:.round,lineJoin:.round))
                let a = screen(track.points[0],size),b = screen(track.points[1],size)
                var flag = context;flag.translateBy(x:a.x,y:a.y);flag.rotate(by:.radians(atan2(b.y-a.y,b.x-a.x)))
                for row in 0..<2 { for col in 0..<6 {
                    flag.fill(Path(CGRect(x:Double(row)*width/6-width/6,y:Double(col)*width/6-width/2,width:width/6,height:width/6)),with:.color((row+col)%2==0 ? .white : .black))
                } }
                for index in [10,90,170,250] {
                    let a = screen(track.points[index],size),b = screen(track.points[index+2],size)
                    var arrowContext = context;arrowContext.translateBy(x:a.x,y:a.y);arrowContext.rotate(by:.radians(atan2(b.y-a.y,b.x-a.x)))
                    let arrow = Path {p in p.move(to:CGPoint(x:-5,y:-4));p.addLine(to:CGPoint(x:2,y:0));p.addLine(to:CGPoint(x:-5,y:4))}
                    arrowContext.stroke(arrow,with:.color(.yellow),style:StrokeStyle(lineWidth:2,lineCap:.round))
                }
                if let line = game.drawing?.points { context.stroke(path(line,size),with:.color(.purple.opacity(0.9)),style:StrokeStyle(lineWidth:3,lineCap:.round,lineJoin:.round)) }
                if let lap = game.lap,game.screen == "race" || game.screen == "results" {
                    context.stroke(path(lap.points,size,closed:true),with:.color(.yellow),lineWidth:2)
                    if let ghost = game.ghost,game.elapsed < Double(ghost.timeMs)/1000 { car(ghost,context:context,size:size,ghost:true) }
                    car(lap,context:context,size:size,ghost:false)
                } else {
                    let tip = screen(game.drawing?.points.last ?? track.points[0],size)
                    context.fill(Path(ellipseIn:CGRect(x:tip.x-7,y:tip.y-7,width:14,height:14)),with:.color(.purple))
                    context.fill(Path(ellipseIn:CGRect(x:tip.x-3,y:tip.y-3,width:6,height:6)),with:.color(.white))
                }
            }
            .contentShape(Rectangle())
            .gesture(DragGesture(minimumDistance:0).onChanged { value in
                guard game.screen == "draw" else{return}
                let p = world(value.location,geometry.size)
                if !dragging {
                    dragging = true;panCentre = centre()
                    panning = track.points.map{pow($0[0]-p.x,2)+pow($0[1]-p.y,2)}.min()! > track.width*track.width
                    if !panning { game.touch(0,p) }
                } else if panning,let start = panCentre {
                    game.centre = CGPoint(x:start.x-value.translation.width/scale(geometry.size),y:start.y-value.translation.height/scale(geometry.size))
                } else { game.touch(1,p) }
            }.onEnded { _ in if !panning { game.lift() };dragging = false;panning = false })
            .simultaneousGesture(MagnifyGesture().onChanged { value in
                guard game.screen == "draw" else{return};game.touch(2);game.zoom = min(5,max(1,pinchStart*value.magnification))
            }.onEnded { _ in pinchStart = game.zoom;dragging = false })
            .clipShape(RoundedRectangle(cornerRadius:16))
            .accessibilityLabel("\(track.name) circuit. Draw from the flag, following the arrows. Lift and continue from the purple tip.")
            .accessibilityIdentifier("circuitCanvas")
        }
        .frame(minHeight:160)
    }
    private func car(_ lap: Lap,context: GraphicsContext,size: CGSize,ghost: Bool) {
        let sample = lap.sample(min(game.elapsed,Double(lap.timeMs)/1000)),q = screen(sample.point,size),next = lap.points[(sample.index+1)%lap.points.count]
        var c = context;c.translateBy(x:q.x,y:q.y);c.rotate(by:.radians(atan2(next[1]-sample.point[1],next[0]-sample.point[0])))
        if ghost { c.opacity = 0.45 }
        for x in [-8.0,5.0] { for y in [-8.0,3.0] {c.fill(Path(roundedRect:CGRect(x:x,y:y,width:7,height:5),cornerRadius:1),with:.color(.black))} }
        let color: Color = ghost ? .white : game.colors[game.team]
        c.fill(Path(roundedRect:CGRect(x:-11,y:-4,width:23,height:8),cornerRadius:3),with:.color(color))
        for x in [-10.0,8.0] {c.fill(Path(CGRect(x:x,y:-8,width:3,height:16)),with:.color(color))}
        c.fill(Path(ellipseIn:CGRect(x:-4,y:-2,width:7,height:4)),with:.color(.black))
    }
}
