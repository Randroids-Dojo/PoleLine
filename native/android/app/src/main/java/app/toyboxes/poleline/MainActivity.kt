package app.toyboxes.poleline

import android.app.Activity
import android.app.AlertDialog
import android.content.Intent
import android.content.ActivityNotFoundException
import android.content.res.Configuration
import android.net.Uri
import android.graphics.Color
import android.graphics.Typeface
import android.graphics.drawable.GradientDrawable
import android.media.AudioManager
import android.media.ToneGenerator
import android.os.Bundle
import android.os.Build
import android.os.SystemClock
import android.view.Gravity
import android.view.View
import android.view.WindowManager
import android.widget.Button
import android.widget.LinearLayout
import android.widget.ScrollView
import android.widget.TextView
import org.json.JSONArray
import org.json.JSONObject
import java.util.concurrent.Executors
import android.annotation.SuppressLint
import android.window.OnBackInvokedDispatcher

class MainActivity: Activity() {
    private val ink=Color.rgb(25,48,82);private val paper=Color.rgb(247,244,233);private val yellow=Color.rgb(255,212,87)
    private val teams=arrayOf("Toyboxes scarlet","Plum Comet","Mint Motorworks","Sunbeam Racing","Bluebird Sport","Coral Arrow")
    private val colors=intArrayOf(0xffed584d.toInt(),0xff9868d7.toInt(),0xff35aa8b.toInt(),0xffefb522.toInt(),0xff458fc6.toInt(),0xffe97f98.toInt())
    private lateinit var records: Records
    private lateinit var root: LinearLayout
    private lateinit var controlsHost: LinearLayout
    private var track: Track?=null;private var trackView: TrackView?=null
    private var recordedLap: Lap?=null;private var lapSaved=false;private var previousBest: Int?=null
    private var status: TextView?=null;private var raceButton: Button?=null;private var telemetry: TextView?=null
    private var line=emptyList<V>();private var lap: Lap?=null;private var ghost: Lap?=null
    private var tyre=0;private var screen="home";private var done=false;private var busy=false
    private var elapsed=0.0;private var frameAt=0L;private var paused=false;private var pauseButton: Button?=null
    private var tone: ToneGenerator?=null
    private val worker=Executors.newSingleThreadExecutor()
    private val ticker=object: Runnable {
        override fun run() {
            if(screen!="race")return
            val now=SystemClock.elapsedRealtime();if(!paused)elapsed+=(now-frameAt)/1000.0;frameAt=now
            val current=lap?:return
            if(elapsed>=current.timeMs/1000.0){elapsed=current.timeMs/1000.0;results();return}
            trackView?.elapsed=elapsed;trackView?.invalidate()
            val sample=current.sample(elapsed).second
            telemetry?.text="${lapTime((elapsed*1000).toInt())}   ${(current.speed.getDouble(sample)*3.6).toInt()} km/h\nBattery ${(current.battery.getDouble(sample)*100).toInt()}%   Tyres ${current.temperature.getDouble(sample).toInt()} C"
            status?.text=if(paused)"Paused. Your lap will wait" else if(ghost!=null)"Racing your personal best ghost" else "Your line, brought to life"
            root.postDelayed(this,32)
        }
    }
    override fun onCreate(state: Bundle?) {
        super.onCreate(state);records=Records(this)
        window.statusBarColor=paper;window.navigationBarColor=paper
        window.decorView.systemUiVisibility=View.SYSTEM_UI_FLAG_LIGHT_STATUS_BAR or View.SYSTEM_UI_FLAG_LIGHT_NAVIGATION_BAR
        volumeControlStream=AudioManager.STREAM_MUSIC
        if(Build.VERSION.SDK_INT>=33)onBackInvokedDispatcher.registerOnBackInvokedCallback(OnBackInvokedDispatcher.PRIORITY_DEFAULT){handleBack()}
        try {tone=ToneGenerator(AudioManager.STREAM_MUSIC,45)}catch(_: RuntimeException){}
        if(state?.getString("screen")=="draw")loadTrack(state.getInt("circuit"),state.getDoubleArray("line")) else home()
    }
    private fun dp(v: Int)=(v*resources.displayMetrics.density).toInt()
    private fun layout(): LinearLayout {
        root=LinearLayout(this);root.orientation=LinearLayout.VERTICAL;root.setPadding(dp(16),dp(8),dp(16),dp(12));root.setBackgroundColor(paper)
        root.setOnApplyWindowInsetsListener { view,insets->view.setPadding(dp(16)+insets.systemWindowInsetLeft,dp(8)+insets.systemWindowInsetTop,dp(16)+insets.systemWindowInsetRight,dp(12)+insets.systemWindowInsetBottom);insets }
        controlsHost=root;setContentView(root);window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON);return root
    }
    private fun label(text: String,size: Float=16f,bold: Boolean=false): TextView = TextView(this).also {
        it.text=text;it.textSize=size;it.setTextColor(ink);it.setPadding(0,dp(6),0,dp(6));if(bold)it.setTypeface(null,Typeface.BOLD)
    }
    private fun button(text: String,primary: Boolean=false,action: ()->Unit): Button = Button(this).also {
        it.text=text;it.isAllCaps=false;it.textSize=15f;it.setTextColor(ink);it.minHeight=dp(48)
        it.background=GradientDrawable().apply {setColor(if(primary)yellow else Color.rgb(231,234,225));cornerRadius=dp(14).toFloat()}
        it.setPadding(dp(12),dp(7),dp(12),dp(7));it.setOnClickListener{action()}
    }
    private fun row(vararg children: View): LinearLayout=LinearLayout(this).also { r->
        r.orientation=LinearLayout.HORIZONTAL;r.gravity=Gravity.CENTER_VERTICAL
        children.forEach{v->r.addView(v,LinearLayout.LayoutParams(0,LinearLayout.LayoutParams.WRAP_CONTENT,1f).also{it.setMargins(dp(3),dp(4),dp(3),dp(4))})}
    }
    private fun add(view: View){controlsHost.addView(view,LinearLayout.LayoutParams(-1,-2))}
    private fun stage(canvas: TrackView){
        if(resources.configuration.orientation==Configuration.ORIENTATION_LANDSCAPE){
            val area=LinearLayout(this);area.orientation=LinearLayout.HORIZONTAL
            root.addView(area,LinearLayout.LayoutParams(-1,0,1f));area.addView(canvas,LinearLayout.LayoutParams(0,-1,1f))
            controlsHost=LinearLayout(this);controlsHost.orientation=LinearLayout.VERTICAL;controlsHost.setPadding(dp(12),0,0,0)
            val scroll=ScrollView(this);scroll.addView(controlsHost);area.addView(scroll,LinearLayout.LayoutParams((resources.displayMetrics.widthPixels*.4).toInt(),-1))
        }else root.addView(canvas,LinearLayout.LayoutParams(-1,0,1f).also{it.topMargin=dp(6);it.bottomMargin=dp(6)})
    }
    private fun sound(kind: Int){if(records.sound)tone?.startTone(kind,120)}
    private fun home(){
        screen="home";lap=null;trackView=null;layout()
        add(label("TOYBOXES",13f,true));add(row(label("PoleLine",36f,true),button("Settings"){settings()}))
        add(label("Draw the lap. Find your flow.",19f));add(label("25 fictional circuits. All yours, all offline.",14f))
        val list=LinearLayout(this);list.orientation=LinearLayout.VERTICAL
        val catalog=JSONArray(NativeCore.catalog())
        for(i in 0 until catalog.length()){
            val t=catalog.getJSONObject(i);val best=records.best(t.getString("id"))
            val title=if(i==0)"Start here: ${t.getString("name")}" else "${i.toString().padStart(2,'0')}  ${t.getString("name")}"
            val detail=if(best!=null)"Best ${lapTime(best.getInt("timeMs"))}" else t.getString("character")
            val b=button("$title\n$detail",i==records.last){loadTrack(i)};b.gravity=Gravity.START or Gravity.CENTER_VERTICAL
            b.contentDescription="$title. $detail. Choose circuit"
            list.addView(b,LinearLayout.LayoutParams(-1,dp(78)).also{it.bottomMargin=dp(9)})
        }
        val scroll=ScrollView(this);scroll.addView(list);root.addView(scroll,LinearLayout.LayoutParams(-1,0,1f))
        add(label("No account. No ads. No connection needed.",12f))
    }
    private fun loadTrack(index: Int,restored: DoubleArray?=null){
        if(busy)return;busy=true;screen="loading";layout();add(label("Preparing your circuit...",22f,true))
        worker.execute {
            try {
                val selected=Track.parse(JSONObject(NativeCore.select(index)))
                var drawing=JSONObject(NativeCore.touch(4,0.0,0.0))
                if(restored!=null&&restored.size>=2){drawing=JSONObject(NativeCore.touch(0,restored[0],restored[1]));for(i in 2 until restored.size step 2)drawing=JSONObject(NativeCore.touch(1,restored[i],restored[i+1]));NativeCore.touch(2,0.0,0.0)}
                val best=records.best(selected.id)
                val bestLap=best?.let{val j=JSONObject(NativeCore.race(index,it.getJSONArray("line").points().flat(),it.getInt("tyre")));if(j.optBoolean("valid"))Lap(j) else null}
                runOnUiThread{busy=false;track=selected;ghost=bestLap;records.last=index;tyre=records.tyre(selected.id);line=drawing.getJSONArray("points").points();done=drawing.getBoolean("done");draw()}
            }catch(_: Exception){runOnUiThread{busy=false;home();AlertDialog.Builder(this).setMessage("This circuit could not be prepared. Please try again.").setPositiveButton("OK",null).show()}}
        }
    }
    private fun draw(){
        val t=track?:return;screen="draw";lap=null;layout();window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        add(row(button("Circuits"){confirmLeave()},label(t.name,21f,true)))
        add(label("${t.region}   ${(t.length/1000*10).toInt()/10.0} km   Track ${t.temperature} C",13f))
        val canvas=TrackView(this,t);canvas.teamColor=colors[records.team];canvas.line=line
        trackView=canvas;stage(canvas)
        status=label(if(done)"Lap drawn. Ready to race" else "Start at the flag. Follow the yellow arrows.",14f)
        status?.accessibilityLiveRegion=View.ACCESSIBILITY_LIVE_REGION_POLITE;add(status!!)
        canvas.onTouch={action,p->applyDrawing(JSONObject(NativeCore.touch(action,p.x,p.y)))}
        canvas.onLift={canvas.followIfZoomed()}
        val zoomButton=button("Zoom"){canvas.follow()};zoomButton.contentDescription="Zoom to the line tip"
        val fitButton=button("Fit"){canvas.overview()};fitButton.contentDescription="Fit the whole circuit"
        add(row(button("Undo"){applyDrawing(JSONObject(NativeCore.touch(3,0.0,0.0)))},button("Clear"){applyDrawing(JSONObject(NativeCore.touch(4,0.0,0.0)));canvas.overview()},zoomButton,fitButton))
        add(row(*arrayOf("Soft","Medium","Hard").mapIndexed{i,name->button(if(tyre==i)"[ $name ]" else name,tyre==i){if(line.isEmpty()){tyre=i;records.setTyre(t.id,i);draw()}else AlertDialog.Builder(this).setMessage("Clear your line to choose different tyres.").setPositiveButton("OK",null).show()}}.toTypedArray()))
        raceButton=button("Race your line",true){startRace()};raceButton?.isEnabled=done;raceButton?.alpha=if(done)1f else .45f;add(raceButton!!)
        if(t.index==0&&line.isEmpty())status?.text="Start at the flag. Stay on the road. Lift and continue any time."
    }
    private fun applyDrawing(j: JSONObject){
        val wasDone=done;line=j.getJSONArray("points").points();done=j.getBoolean("done")
        trackView?.line=line;trackView?.invalidate();raceButton?.isEnabled=done;raceButton?.alpha=if(done)1f else .45f
        status?.text="${(j.getDouble("progress")*100).toInt()}%  ${j.getString("message")}"
        if(done&&!wasDone){sound(ToneGenerator.TONE_PROP_ACK);trackView?.overview()}
    }
    private fun startRace(){
        val t=track?:return;if(!done||busy)return;busy=true;raceButton?.isEnabled=false;status?.text="Finding the speed in your line..."
        worker.execute {
            val j=JSONObject(NativeCore.race(t.index,line.flat(),tyre))
            runOnUiThread{busy=false;if(j.optBoolean("valid")){lap=Lap(j);elapsed=0.0;showRace()}else{status?.text=j.optString("error");raceButton?.isEnabled=true}}
        }
    }
    private fun showRace(){
        val t=track?:return;screen="race";layout();window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
        add(label(t.name,24f,true));telemetry=label("0:00.000",22f,true);add(telemetry!!)
        val canvas=TrackView(this,t);canvas.lap=lap;canvas.ghost=ghost;canvas.teamColor=colors[records.team];trackView=canvas;stage(canvas)
        status=label("Your line, brought to life",15f);add(status!!)
        paused=false;frameAt=SystemClock.elapsedRealtime()
        pauseButton=button("Pause"){paused=!paused;frameAt=SystemClock.elapsedRealtime();pauseButton?.text=if(paused)"Resume" else "Pause"}
        add(row(pauseButton!!,button("Finish lap"){results()}));root.post(ticker);sound(ToneGenerator.TONE_PROP_BEEP)
    }
    private fun results(){
        val t=track?:return;val current=lap?:return;screen="results";root.removeCallbacks(ticker)
        if(recordedLap!==current){previousBest=records.best(t.id)?.optInt("timeMs");lapSaved=records.save(t.id,current,line);recordedLap=current}
        val previous=previousBest;val saved=lapSaved
        layout();add(label("${t.medal(current.timeMs)} lap",18f,true));add(label(lapTime(current.timeMs),42f,true));add(label(t.name,22f,true))
        add(label(if(saved)"New personal best. Saved on this device." else if(previous!=null)"${if(current.timeMs>=previous)"+" else ""}${(current.timeMs-previous)/1000.0}s to your best" else "Lap complete. Device storage could not save this record.",15f))
        val canvas=TrackView(this,t);canvas.lap=current;canvas.elapsed=current.timeMs/1000.0;canvas.teamColor=colors[records.team];trackView=canvas;stage(canvas)
        val sectors=current.json.getJSONArray("sectors");add(label("S1 ${lapTime(sectors.getInt(0))}   S2 ${lapTime(sectors.getInt(1))}   S3 ${lapTime(sectors.getInt(2))}",13f,true))
        add(label("Top speed ${current.json.getDouble("topSpeed").toInt()} km/h   Gold ${lapTime(t.gold)}",14f))
        add(label(when {current.timeMs<=t.gold->"A flowing lap. Try a different tyre to find the last fraction.";current.timeMs<=t.silver->"Open the corner entry and aim for a smoother exit.";else->"Look ahead. A calm, smooth line carries more speed than a tight zigzag."},14f))
        add(row(button("Draw again",true){if(saved)ghost=current;line=emptyList();done=false;NativeCore.touch(4,0.0,0.0);draw()},button("Replay"){elapsed=0.0;showRace()},button("Circuits"){home()}))
        sound(if(saved)ToneGenerator.TONE_PROP_ACK else ToneGenerator.TONE_PROP_BEEP)
    }
    private fun confirmLeave(){if(line.isEmpty())home()else AlertDialog.Builder(this).setTitle("Leave this line?").setMessage("Your personal bests stay saved. This unfinished drawing will be cleared.").setNegativeButton("Keep drawing",null).setPositiveButton("Leave"){_,_->home()}.show()}
    private fun settings(){
        AlertDialog.Builder(this).setTitle("PoleLine by Toyboxes").setItems(arrayOf("Your car: ${teams[records.team]}","Sound: ${if(records.sound)"on" else "off"}","How to play","Privacy and support","Reset local records")){_,which->when(which){
            0->AlertDialog.Builder(this).setTitle("Fictional racing teams").setSingleChoiceItems(teams,records.team){dialog,index->records.team=index;dialog.dismiss();trackView?.teamColor=colors[index];trackView?.invalidate()}.setNegativeButton("Cancel",null).show()
            1->{records.sound=!records.sound;settings()}
            2->AlertDialog.Builder(this).setTitle("Draw the lap").setMessage("Choose a circuit and tyre. Start at the chequered flag, then draw in the direction of the yellow arrows. Stay on the road. Lift any time and continue from the purple tip.\n\nPinch to zoom. Drag the grass to pan, or use Zoom to return to the line tip. Fit shows the whole circuit. Undo removes your last stroke. Close the loop, then race your line.\n\nSmooth corners carry more speed. Soft tyres warm quickly; medium and hard tyres handle hotter conditions. Earn medals and race your own best ghost. Everything is stored on this device.").setPositiveButton("Let's play",null).show()
            3->AlertDialog.Builder(this).setTitle("Your game stays on your device").setMessage("PoleLine collects no data. No analytics, ads, accounts, in-app purchases, network access or cloud saves. Circuits, simulation and records work offline from the first launch. Android cloud backup and device transfer of game data are disabled.\n\nUninstalling clears local progress.\n\nSupport: support@toyboxes.app\nPrivacy: toyboxes.app/games/poleline/privacy/\nVersion 1.0.0 (2)\nCopyright 2026 Randroid LLC").setNeutralButton("Online policy"){_,_->try{startActivity(Intent(Intent.ACTION_VIEW,Uri.parse("https://toyboxes.app/games/poleline/privacy/")))}catch(_:ActivityNotFoundException){}}.setPositiveButton("OK",null).show()
            4->AlertDialog.Builder(this).setTitle("Delete all local records?").setMessage("This clears lap records and settings on this device. It cannot be undone.").setNegativeButton("Cancel",null).setPositiveButton("Delete"){_,_->records.clear();home()}.show()
        }}.setNegativeButton("Done",null).show()
    }
    private fun handleBack(){when(screen){"draw"->confirmLeave();"race"->{paused=true;pauseButton?.text="Resume";AlertDialog.Builder(this).setTitle("Leave this replay?").setNegativeButton("Stay",null).setPositiveButton("Results"){_,_->results()}.show()};"results"->home();else->finish()}}
    // API 33+ uses OnBackInvokedDispatcher above. This override serves API 26 through 32.
    @SuppressLint("GestureBackNavigation")
    @Deprecated("Legacy API back callback")
    override fun onBackPressed(){handleBack()}
    override fun onPause(){super.onPause();if(screen=="race"){paused=true;pauseButton?.text="Resume";root.removeCallbacks(ticker)};if(screen=="draw")NativeCore.touch(2,0.0,0.0)}
    override fun onResume(){super.onResume();if(screen=="race"){frameAt=SystemClock.elapsedRealtime();root.removeCallbacks(ticker);root.post(ticker)}}
    override fun onConfigurationChanged(newConfig: Configuration){super.onConfigurationChanged(newConfig);when(screen){"draw"->draw();"race"->{val wasPaused=paused;root.removeCallbacks(ticker);showRace();paused=wasPaused;pauseButton?.text=if(paused)"Resume" else "Pause"};"results"->results();"home"->home()}}
    override fun onSaveInstanceState(out: Bundle){super.onSaveInstanceState(out);if(screen=="draw"){out.putString("screen",screen);out.putInt("circuit",track?.index?:0);out.putDoubleArray("line",line.flat())}}
    override fun onDestroy(){root.removeCallbacks(ticker);tone?.release();worker.shutdown();super.onDestroy()}
}
