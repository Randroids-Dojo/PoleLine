package app.toyboxes.poleline

import android.annotation.SuppressLint
import android.content.Context
import android.graphics.Canvas
import android.graphics.Color
import android.graphics.Paint
import android.graphics.Path
import android.view.MotionEvent
import android.view.ScaleGestureDetector
import android.view.View
import kotlin.math.atan2
import kotlin.math.max
import kotlin.math.min

class TrackView(context: Context, val track: Track) : View(context) {
    var line: List<V> = emptyList()
    var lap: Lap? = null
    var ghost: Lap? = null
    var elapsed = 0.0
    var teamColor = Color.rgb(237,88,77)
    var onTouch: ((Int, V) -> Unit)? = null
    var onLift: (() -> Unit)? = null
    private val paint = Paint(Paint.ANTI_ALIAS_FLAG)
    private val density = resources.displayMetrics.density
    private val minX = track.points.minOf { it.x }; private val maxX = track.points.maxOf { it.x }
    private val minY = track.points.minOf { it.y }; private val maxY = track.points.maxOf { it.y }
    private var centre = V((minX+maxX)/2,(minY+maxY)/2)
    private var zoom = 1.0
    private var panning = false
    private var lastX = 0f; private var lastY = 0f
    private val scaler = ScaleGestureDetector(context, object: ScaleGestureDetector.SimpleOnScaleGestureListener() {
        override fun onScaleBegin(detector: ScaleGestureDetector): Boolean { onTouch?.invoke(2,V(0.0,0.0)); return true }
        override fun onScale(detector: ScaleGestureDetector): Boolean { zoom=(zoom*detector.scaleFactor).coerceIn(1.0,5.0); invalidate(); return true }
    })
    init {
        isFocusable = true
        contentDescription = "${track.name} racing circuit. Start on the chequered line and draw around the road. Pinch to zoom. Drag the grass to pan."
        setLayerType(LAYER_TYPE_HARDWARE,null)
    }
    private fun scale() = min((width-40*density)/(maxX-minX+track.width*2),(height-48*density)/(maxY-minY+track.width*2))*zoom
    private fun screen(p: V) = V(width/2.0+(p.x-centre.x)*scale(),height/2.0+(p.y-centre.y)*scale())
    private fun world(x: Float,y: Float) = V((x-width/2.0)/scale()+centre.x,(y-height/2.0)/scale()+centre.y)
    fun overview() { zoom=1.0; centre=V((minX+maxX)/2,(minY+maxY)/2); invalidate() }
    fun follow() { zoom=2.4;centre=line.lastOrNull()?:track.points.first();invalidate() }
    fun followIfZoomed() { if(zoom>1.1){centre=line.lastOrNull()?:track.points.first();invalidate()} }
    private fun path(points: List<V>,closed: Boolean): Path {
        val p=Path();points.forEachIndexed { i,v->val q=screen(v);if(i==0)p.moveTo(q.x.toFloat(),q.y.toFloat()) else p.lineTo(q.x.toFloat(),q.y.toFloat()) };if(closed)p.close();return p
    }
    private fun stroke(canvas: Canvas,p: Path,color: Int,width: Double) {
        paint.color=color;paint.style=Paint.Style.STROKE;paint.strokeWidth=width.toFloat();paint.strokeCap=Paint.Cap.ROUND;paint.strokeJoin=Paint.Join.ROUND;canvas.drawPath(p,paint)
    }
    override fun onDraw(canvas: Canvas) {
        super.onDraw(canvas)
        canvas.drawColor(if(track.night) Color.rgb(25,48,62) else Color.rgb(209,226,200))
        paint.style=Paint.Style.FILL;paint.color=if(track.night)0x334c7b77 else 0x22729565
        for(i in 0..12)for(j in 0..16)canvas.drawCircle(i*width/12f,j*height/16f,1.7f*density,paint)
        val road=path(track.points,true);val roadWidth=track.width*scale()
        stroke(canvas,road,Color.rgb(240,111,81),roadWidth+9*density)
        stroke(canvas,road,Color.rgb(250,244,224),roadWidth+4*density)
        stroke(canvas,road,Color.rgb(61,76,81),roadWidth)
        val start=screen(track.points[0]);val next=screen(track.points[1])
        val angle=atan2(next.y-start.y,next.x-start.x)*180/Math.PI
        canvas.save();canvas.translate(start.x.toFloat(),start.y.toFloat());canvas.rotate(angle.toFloat())
        paint.style=Paint.Style.FILL
        val cell=(roadWidth/6).toFloat()
        for(row in 0..1)for(col in 0..5){paint.color=if((row+col)%2==0)Color.WHITE else Color.rgb(25,48,62);canvas.drawRect(row*cell-cell,col*cell-roadWidth.toFloat()/2,(row+1)*cell-cell,(col+1)*cell-roadWidth.toFloat()/2,paint)}
        canvas.restore()
        // Direction arrows remain visible before a line is drawn.
        for(index in listOf(10,90,170,250)) {
            val a=screen(track.points[index]);val b=screen(track.points[(index+2)%track.points.size]);val theta=atan2(b.y-a.y,b.x-a.x)
            canvas.save();canvas.translate(a.x.toFloat(),a.y.toFloat());canvas.rotate((theta*180/Math.PI).toFloat())
            val arrow=Path();arrow.moveTo(-5*density,-4*density);arrow.lineTo(2*density,0f);arrow.lineTo(-5*density,4*density)
            stroke(canvas,arrow,Color.rgb(255,212,87),2.0*density);canvas.restore()
        }
        if(line.isNotEmpty())stroke(canvas,path(line,false),Color.rgb(184,136,255),3.0*density)
        lap?.let { current ->
            stroke(canvas,path(current.points,true),Color.rgb(255,212,87),2.0*density)
            ghost?.takeIf { elapsed < it.timeMs/1000.0 }?.let { drawCar(canvas,it,true) }
            drawCar(canvas,current,false)
        } ?: run {
            val tip=screen(line.lastOrNull()?:track.points.first());paint.style=Paint.Style.FILL;paint.color=Color.rgb(181,132,255);canvas.drawCircle(tip.x.toFloat(),tip.y.toFloat(),7*density,paint)
            paint.color=Color.WHITE;canvas.drawCircle(tip.x.toFloat(),tip.y.toFloat(),3*density,paint)
        }
    }
    private fun drawCar(canvas: Canvas,run: Lap,isGhost: Boolean) {
        val (p,index)=run.sample(elapsed.coerceAtMost(run.timeMs/1000.0));val q=screen(p);val next=run.points[(index+1)%run.points.size]
        val angle=atan2(next.y-p.y,next.x-p.x)*180/Math.PI
        canvas.save();canvas.translate(q.x.toFloat(),q.y.toFloat());canvas.rotate(angle.toFloat())
        paint.style=Paint.Style.FILL;paint.color=if(isGhost)Color.argb(130,239,244,250) else Color.rgb(24,40,56)
        val d=density
        canvas.drawRoundRect(-8*d,-8*d,0f,-3*d,1*d,1*d,paint);canvas.drawRoundRect(-8*d,3*d,0f,8*d,1*d,1*d,paint)
        canvas.drawRoundRect(5*d,-8*d,10*d,-3*d,1*d,1*d,paint);canvas.drawRoundRect(5*d,3*d,10*d,8*d,1*d,1*d,paint)
        paint.color=if(isGhost)Color.argb(150,239,244,250) else teamColor
        canvas.drawRoundRect(-11*d,-4*d,12*d,4*d,3*d,3*d,paint)
        canvas.drawRect(8*d,-8*d,11*d,8*d,paint);canvas.drawRect(-10*d,-8*d,-7*d,8*d,paint)
        paint.color=Color.rgb(28,51,67);canvas.drawOval(-4*d,-2*d,3*d,2*d,paint)
        canvas.restore()
    }
    @SuppressLint("ClickableViewAccessibility")
    override fun onTouchEvent(event: MotionEvent): Boolean {
        if(lap!=null)return true
        scaler.onTouchEvent(event);if(scaler.isInProgress||event.pointerCount>1)return true
        val p=world(event.x,event.y)
        when(event.actionMasked) {
            MotionEvent.ACTION_DOWN -> {
                parent.requestDisallowInterceptTouchEvent(true);lastX=event.x;lastY=event.y
                panning=track.points.minOf { (it.x-p.x)*(it.x-p.x)+(it.y-p.y)*(it.y-p.y) }>track.width*track.width
                if(!panning)onTouch?.invoke(0,p)
            }
            MotionEvent.ACTION_MOVE -> {
                if(panning){centre=V(centre.x-(event.x-lastX)/scale(),centre.y-(event.y-lastY)/scale());invalidate()}
                else for(i in 0 until event.historySize)onTouch?.invoke(1,world(event.getHistoricalX(i),event.getHistoricalY(i)))
                if(!panning)onTouch?.invoke(1,p)
                lastX=event.x;lastY=event.y
            }
            MotionEvent.ACTION_UP,MotionEvent.ACTION_CANCEL -> {onTouch?.invoke(2,p);if(!panning)onLift?.invoke();parent.requestDisallowInterceptTouchEvent(false);performClick()}
        }
        return true
    }
    override fun performClick(): Boolean {super.performClick();return true}
}
