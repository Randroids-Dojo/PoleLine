package app.toyboxes.poleline

import android.Manifest
import android.app.Instrumentation
import android.content.Intent
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.os.SystemClock
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.TextView
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.json.JSONObject
import org.junit.Assert.*
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import kotlin.math.min

@RunWith(AndroidJUnit4::class)
class OfflineGameplayTest {
    private val instrumentation: Instrumentation = InstrumentationRegistry.getInstrumentation()
    private fun descendants(view: View): List<View> = listOf(view) + if(view is ViewGroup)(0 until view.childCount).flatMap{descendants(view.getChildAt(it))} else emptyList()
    private fun waitFor(activity: MainActivity, predicate: (View)->Boolean): View {
        val deadline=SystemClock.uptimeMillis()+15000
        while(SystemClock.uptimeMillis()<deadline){var result: View?=null;instrumentation.runOnMainSync{result=descendants(activity.window.decorView).firstOrNull(predicate)};if(result!=null)return result!!;SystemClock.sleep(100)}
        throw AssertionError("Expected native view did not appear")
    }
    private fun click(activity: MainActivity,text: String){val view=waitFor(activity){it is Button&&it.text.toString().contains(text)};instrumentation.runOnMainSync{view.performClick()};instrumentation.waitForIdleSync()}
    private fun screenshot(name: String){instrumentation.waitForIdleSync();SystemClock.sleep(350);val bitmap=instrumentation.uiAutomation.takeScreenshot();val file=File(instrumentation.targetContext.getExternalFilesDir(null),"$name.png");file.outputStream().use{bitmap.compress(Bitmap.CompressFormat.PNG,100,it)};bitmap.recycle()}
    @Test fun firstLaunchDrawRaceReplayAndPersistWithoutNetworkPermission(){
        val context=instrumentation.targetContext
        assertEquals(PackageManager.PERMISSION_DENIED,context.checkSelfPermission(Manifest.permission.INTERNET))
        Records(context).clear()
        val intent=Intent(context,MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_NEW_TASK or Intent.FLAG_ACTIVITY_CLEAR_TASK)
        val activity=instrumentation.startActivitySync(intent) as MainActivity
        screenshot("01-home")
        click(activity,"Start here:")
        val canvas=waitFor(activity){it is TrackView} as TrackView
        val t=canvas.track;val coordinates=IntArray(2)
        instrumentation.runOnMainSync{canvas.getLocationOnScreen(coordinates)}
        val d=context.resources.displayMetrics.density
        val minX=t.points.minOf{it.x};val maxX=t.points.maxOf{it.x};val minY=t.points.minOf{it.y};val maxY=t.points.maxOf{it.y}
        val scale=min((canvas.width-40*d)/(maxX-minX+t.width*2),(canvas.height-48*d)/(maxY-minY+t.width*2))
        fun point(p: V)=Pair((coordinates[0]+canvas.width/2+(p.x-(minX+maxX)/2)*scale).toFloat(),(coordinates[1]+canvas.height/2+(p.y-(minY+maxY)/2)*scale).toFloat())
        val down=SystemClock.uptimeMillis()
        fun event(action: Int,p: V){val xy=point(p);val e=MotionEvent.obtain(down,SystemClock.uptimeMillis(),action,xy.first,xy.second,0);instrumentation.sendPointerSync(e);e.recycle()}
        event(MotionEvent.ACTION_DOWN,t.points[0])
        for(p in t.points.drop(1))event(MotionEvent.ACTION_MOVE,p)
        event(MotionEvent.ACTION_MOVE,t.points[0]);event(MotionEvent.ACTION_UP,t.points[0]);instrumentation.waitForIdleSync()
        val race=waitFor(activity){it is Button&&it.text=="Race your line"} as Button
        assertTrue("Actual native pointer input must complete the circuit",race.isEnabled)
        screenshot("02-drawn-line")
        click(activity,"Race your line")
        waitFor(activity){it is Button&&it.text=="Pause"};SystemClock.sleep(1200);screenshot("03-race")
        click(activity,"Pause");assertNotNull(waitFor(activity){it is Button&&it.text=="Resume"})
        click(activity,"Resume");click(activity,"Finish lap")
        waitFor(activity){it is Button&&it.text=="Draw again"};screenshot("04-results")
        val record=Records(context).best(t.id);assertNotNull("Completed lap persists locally",record)
        waitFor(activity){it is TextView&&it.text.toString().startsWith("New personal best.")}
        click(activity,"Replay");waitFor(activity){it is Button&&it.text=="Pause"}
        click(activity,"Finish lap")
        waitFor(activity){it is TextView&&it.text.toString().startsWith("New personal best.")}
        click(activity,"Replay");waitFor(activity){it is Button&&it.text=="Pause"}
        instrumentation.runOnMainSync{activity.recreate()};instrumentation.waitForIdleSync()
        assertEquals(record!!.getInt("timeMs"),Records(context).best(t.id)!!.getInt("timeMs"))
    }
    @Test fun malformedInputAndUndoRecover(){
        NativeCore.select(0)
        val t=Track.parse(JSONObject(NativeCore.select(0)))
        val rejected=JSONObject(NativeCore.race(0,doubleArrayOf(0.0,0.0,1.0,1.0),0));assertFalse(rejected.getBoolean("valid"))
        NativeCore.touch(0,t.points[0].x,t.points[0].y)
        t.points.take(50).forEach{NativeCore.touch(1,it.x,it.y)}
        val undone=JSONObject(NativeCore.touch(3,0.0,0.0));assertEquals(0,undone.getJSONArray("points").length())
    }
}
