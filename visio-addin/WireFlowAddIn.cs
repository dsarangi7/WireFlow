// Prototype desktop COM add-in. Engineers explicitly mark every terminal.
// Wires are draft straight lines; engineering must approve routes and harnesses.
using System;
using System.Collections.Generic;
using System.Globalization;
using System.Reflection;
using System.Runtime.InteropServices;
using System.Windows.Forms;
using System.IO;
using System.Web.Script.Serialization;

namespace Ayk.WireFlow.VisioAddIn {
    [ComVisible(true), Guid("B65AD801-ABAF-11D0-BB8B-00A0C90F2744"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IDTExtensibility2 {
        [DispId(1)] void OnConnection([MarshalAs(UnmanagedType.IDispatch)] object application, int connectMode, [MarshalAs(UnmanagedType.IDispatch)] object addInInst, ref Array custom);
        [DispId(2)] void OnDisconnection(int removeMode, ref Array custom);
        [DispId(3)] void OnAddInsUpdate(ref Array custom);
        [DispId(4)] void OnStartupComplete(ref Array custom);
        [DispId(5)] void OnBeginShutdown(ref Array custom);
    }
    [ComVisible(true), Guid("000C0396-0000-0000-C000-000000000046"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IRibbonExtensibility { [DispId(1)] string GetCustomUI(string ribbonId); }
    [ComVisible(true), Guid("A93A0C27-8C7C-4A96-B777-67DA7B92D10D"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IWireFlowCallbacks { [DispId(1)] void OpenWorkspace([MarshalAs(UnmanagedType.IDispatch)] object control); }

    [ComVisible(true), Guid("E1CE7134-5A5D-4B05-BC55-93BF487456CB"), ProgId("AYK.WireFlow.VisioAddIn"), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IWireFlowCallbacks))]
    public sealed class WireFlowAddIn : IDTExtensibility2, IRibbonExtensibility, IWireFlowCallbacks {
        private object host;
        private WorkspaceForm form;
        public void OnConnection(object application, int connectMode, object addInInst, ref Array custom) { host = application; }
        public void OnDisconnection(int removeMode, ref Array custom) { if (form != null) form.Close(); form = null; host = null; }
        public void OnAddInsUpdate(ref Array custom) { }
        public void OnStartupComplete(ref Array custom) { }
        public void OnBeginShutdown(ref Array custom) { if (form != null) form.Close(); }
        public string GetCustomUI(string ribbonId) {
            return "<customUI xmlns=\"http://schemas.microsoft.com/office/2006/01/customui\"><ribbon><tabs><tab id=\"aykWireFlow\" label=\"AYK WireFlow\"><group id=\"aykDraft\" label=\"Draft wiring\"><button id=\"aykOpen\" label=\"Open WireFlow\" size=\"large\" onAction=\"OpenWorkspace\"/></group></tab></tabs></ribbon></customUI>";
        }
        public void OpenWorkspace(object control) {
            try { if (host == null) throw new InvalidOperationException("Connect to Visio first."); if (form == null || form.IsDisposed) form = new WorkspaceForm(host); form.Show(); form.Activate(); }
            catch (Exception ex) { MessageBox.Show(ex.Message, "AYK WireFlow", MessageBoxButtons.OK, MessageBoxIcon.Error); }
        }
    }

    public sealed class Point { public double X; public double Y; public Point(double x, double y) { if (Double.IsNaN(x) || Double.IsInfinity(x) || Double.IsNaN(y) || Double.IsInfinity(y)) throw new ArgumentException("Invalid terminal coordinates."); X=x; Y=y; } }
    public sealed class Segment { public string Network; public string From; public string To; public Point A; public Point B; }
    // Visio's AddAdvise accepts an IDispatch sink. Mouse coordinates arrive in
    // Visio internal drawing units; confirmation against real zoom/pan is pending.
    [ComVisible(true), Guid("F00478F4-2CB1-426E-BB77-0A873DDC81CD"), InterfaceType(ComInterfaceType.InterfaceIsIDispatch)]
    public interface IPageMouseSink {
        [DispId(1)] object VisEventProc(short code, object source, int eventId, int sequence, object subject, object moreInfo);
    }
    [ComVisible(true), ClassInterface(ClassInterfaceType.None), ComDefaultInterface(typeof(IPageMouseSink))]
    public sealed class PageMouseSink : IPageMouseSink {
        private Func<object,double,double,bool> accept;
        private Action<string> error;
        [ComVisible(false)] public void SetHandlers(Func<object,double,double,bool> onPoint, Action<string> onError) { accept=onPoint; error=onError; }
        public object VisEventProc(short code, object source, int eventId, int sequence, object subject, object moreInfo) {
            if (code != 709 || accept == null || subject == null) return false;
            try {
                dynamic mouse=subject;
                if ((int)mouse.Button != 1) return false;
                object eventPage=mouse.Window.Page;
                return accept(eventPage, (double)mouse.x, (double)mouse.y);
            } catch(Exception ex) { if (error != null) error(ex.Message); return false; }
        }
    }
    public sealed class DraftPlan {
        public readonly Dictionary<string, Point> Terminals = new Dictionary<string, Point>();
        public int Modules;
        public void Set(string name, double x, double y) {
            var point = new Point(x,y);
            foreach (var entry in Terminals) if (entry.Key != name && entry.Value.X == x && entry.Value.Y == y) throw new InvalidOperationException("This marker is already assigned to " + entry.Key + ". Select a different terminal marker.");
            Terminals[name] = point;
        }
        public bool Remove(string name) { return Terminals.Remove(name); }
        private Point Require(string key) { Point p; if (!Terminals.TryGetValue(key, out p)) throw new InvalidOperationException("Missing terminal: " + key); return p; }
        private Segment Connect(string network, string a, string b) { return new Segment { Network=network, From=a, To=b, A=Require(a), B=Require(b) }; }
        public List<Segment> Build() {
            if (Modules < 2 || Modules > 48) throw new InvalidOperationException("Enter 2 to 48 modules in the chain.");
            var result = new List<Segment>();
            result.Add(Connect("POWER", "SSC.POS", "M1.POS"));
            result.Add(Connect("COMM", "SSC.S", "M1.N"));
            for (int i=1; i<Modules; i++) {
                result.Add(Connect("POWER", "M"+i+".NEG", "M"+(i+1)+".POS"));
                result.Add(Connect("COMM", "M"+i+".S", "M"+(i+1)+".N"));
            }
            result.Add(Connect("POWER", "SSC.NEG", "M"+Modules+".NEG"));
            result.Add(Connect("COMM", "SSC.N", "M"+Modules+".S"));
            result.Add(Connect("POWER", "SSC.B-", "JB.NEG"));
            result.Add(Connect("POWER", "SSC.B+", "JB.POS"));
            return result;
        }
    }
    public sealed class MarkEntry { public string Name { get; set; } public double X { get; set; } public double Y { get; set; } }
    public sealed class MarkFile {
        public int Version { get; set; }
        public string DrawingPath { get; set; }
        public int PageId { get; set; }
        public int Modules { get; set; }
        public List<MarkEntry> Marks { get; set; }
    }
    public static class MarkPersistence {
        public static List<string> Steps(int modules) {
            if (modules < 2 || modules > 48) throw new InvalidOperationException("Enter 2 to 48 modules in the chain.");
            var steps = new List<string> { "SSC.S","SSC.N","SSC.NEG","SSC.POS","SSC.B-","SSC.B+","JB.NEG","JB.POS" };
            for (int i=1; i<=modules; i++) foreach (var port in new [] {"S","N","NEG","POS"}) steps.Add("M"+i+"."+port);
            return steps;
        }
        public static string Serialize(DraftPlan plan, string drawingPath, int pageId, int count) {
            var steps=Steps(plan.Modules);
            if (String.IsNullOrWhiteSpace(drawingPath) || pageId < 0 || count < 0 || count > steps.Count || plan.Terminals.Count != count) throw new InvalidOperationException("Cannot save an invalid marking session.");
            var file=new MarkFile { Version=1, DrawingPath=Path.GetFullPath(drawingPath), PageId=pageId, Modules=plan.Modules, Marks=new List<MarkEntry>() };
            for(int i=0;i<count;i++) {
                Point p; if(!plan.Terminals.TryGetValue(steps[i],out p)) throw new InvalidOperationException("Terminal markings must be in order.");
                file.Marks.Add(new MarkEntry { Name=steps[i], X=p.X, Y=p.Y });
            }
            return new JavaScriptSerializer().Serialize(file);
        }
        public static DraftPlan Deserialize(string json, string drawingPath, int pageId, out int count) {
            if (json == null || json.Length > 1048576 || String.IsNullOrWhiteSpace(drawingPath)) throw new InvalidOperationException("The marking file or active drawing is invalid.");
            var file=new JavaScriptSerializer().Deserialize<MarkFile>(json);
            if (file == null || file.Version != 1 || String.IsNullOrWhiteSpace(file.DrawingPath) || file.PageId != pageId || !String.Equals(Path.GetFullPath(file.DrawingPath),Path.GetFullPath(drawingPath),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("This marking file belongs to another drawing or page.");
            var steps=Steps(file.Modules);
            if (file.Marks == null || file.Marks.Count > steps.Count) throw new InvalidOperationException("The marking file has invalid entries.");
            var plan=new DraftPlan { Modules=file.Modules };
            for(int i=0;i<file.Marks.Count;i++) {
                var mark=file.Marks[i]; if(mark == null || mark.Name != steps[i]) throw new InvalidOperationException("The marking file is not in the required order.");
                plan.Set(mark.Name,mark.X,mark.Y);
            }
            count=file.Marks.Count; return plan;
        }
    }
    public static class DraftRenderer {
        public static int Draw(object application, object page, DraftPlan plan) {
            // Validate all endpoints before touching the page. Undo scope rolls back a partial failure.
            var segments = plan.Build();
            dynamic app = application; dynamic pg = page;
            int scope = app.BeginUndoScope("AYK WireFlow draft wiring");
            try {
                foreach (var segment in segments) {
                    dynamic shape = pg.DrawLine(segment.A.X, segment.A.Y, segment.B.X, segment.B.Y);
                    shape.CellsU["LineColor"].FormulaU = segment.Network == "POWER" ? "RGB(255,0,0)" : "RGB(0,176,80)";
                    shape.CellsU["LineWeight"].FormulaU = "0.012 in";
                    shape.Text = "";
                }
                app.EndUndoScope(scope, true); return segments.Count;
            } catch { app.EndUndoScope(scope, false); throw; }
        }
    }

    internal sealed class WorkspaceForm : Form {
        private readonly dynamic app;
        private readonly DraftPlan plan = new DraftPlan();
        private readonly NumericUpDown count = new NumericUpDown { Minimum=2, Maximum=48, Value=12, Width=70 };
        private readonly Label status = new Label { AutoSize=false, Width=520, Height=92 };
        private readonly Button mark = new Button { Text="Record selected terminal marker", Width=245, Height=40 };
        private readonly Button undo = new Button { Text="Undo last terminal mark", Width=245, Height=36 };
        private readonly Button saveMarks = new Button { Text="Save terminal marks", Width=245, Height=36 };
        private readonly Button loadMarks = new Button { Text="Load terminal marks", Width=245, Height=36 };
        private readonly Button pick = new Button { Text="Click ports on drawing", Width=245, Height=40 };
        private readonly Button draw = new Button { Text="Draw draft on active page", Width=245, Height=40 };
        private readonly List<string> prompts = new List<string>();
        private int next;
        private object page;
        private dynamic mouseEvent;
        private PageMouseSink mouseSink;
        private bool picking;
        public WorkspaceForm(object application) {
            app=application; Text="AYK WireFlow — prototype"; Width=580; Height=340; TopMost=true;
            var layout=new FlowLayoutPanel { Dock=DockStyle.Fill, FlowDirection=FlowDirection.TopDown, Padding=new Padding(12), WrapContents=false, AutoScroll=true };
            layout.Controls.Add(new Label { Text="Modules in this SSC chain:", Width=500, Height=22 }); layout.Controls.Add(count);
            var start=new Button { Text="Start terminal marking", Width=245, Height=36 };
            layout.Controls.Add(start); layout.Controls.Add(status); layout.Controls.Add(pick); layout.Controls.Add(mark); layout.Controls.Add(undo); layout.Controls.Add(saveMarks); layout.Controls.Add(loadMarks); layout.Controls.Add(draw); Controls.Add(layout);
            start.Click += delegate { StartPlan(); }; mark.Click += delegate { Record(); }; pick.Click += delegate { TogglePicking(); }; undo.Click += delegate { UndoMark(); }; draw.Click += delegate { Draw(); };
            saveMarks.Click += delegate { SaveMarks(); }; loadMarks.Click += delegate { LoadMarks(); };
            FormClosed += delegate { StopPicking(); };
#if !EXPERIMENTAL_MOUSE_PICKING
            pick.Visible=false;
#endif
            pick.Enabled=false; mark.Enabled=false; undo.Enabled=false; saveMarks.Enabled=false; draw.Enabled=false;
#if EXPERIMENTAL_MOUSE_PICKING
            status.Text="Pilot: mark terminal positions in order, directly on the drawing or by selecting marker shapes.";
#else
            status.Text="Pilot: create and select a small Visio marker shape at each terminal, then record it.";
#endif
        }
        private void StartPlan() {
            try {
                StopPicking(); page=app.ActivePage; if (page == null) throw new InvalidOperationException("Open a Visio drawing first.");
                plan.Terminals.Clear(); plan.Modules=(int)count.Value; prompts.Clear(); next=0;
                prompts.AddRange(MarkPersistence.Steps(plan.Modules));
                // The event sink needs real interactive Visio validation before
                // it can be enabled in a build intended for other users.
#if EXPERIMENTAL_MOUSE_PICKING
                pick.Enabled=true;
#else
                pick.Enabled=false;
#endif
                mark.Enabled=true; undo.Enabled=false; saveMarks.Enabled=true; draw.Enabled=false; ShowPrompt();
            } catch (Exception ex) { status.Text="Could not start: "+ex.Message; }
        }
        private void ShowPrompt() {
            string guidance;
#if EXPERIMENTAL_MOUSE_PICKING
            guidance=picking ? "Click port centres in order. Stop clicking to navigate normally." : "Click ports directly, or select a marker and record it.";
#else
            guidance="Select a marker shape at this port, then click Record.";
#endif
            status.Text="Step "+(next+1)+" of "+prompts.Count+": "+(picking ? "Click " : "Mark ")+prompts[next]+" on the drawing.\n"+guidance;
        }
        private void StopPicking() {
            picking=false; pick.Text="Click ports on drawing";
            if (mouseEvent != null) { try { mouseEvent.Delete(); } catch { } mouseEvent=null; }
            mouseSink=null;
        }
        private void TogglePicking() {
            if (picking) { StopPicking(); ShowPrompt(); return; }
            try {
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                mouseSink=new PageMouseSink();
                mouseSink.SetHandlers(AcceptClick, delegate(string message) { if (!IsDisposed) status.Text="Could not record click: "+message; });
                mouseEvent=app.EventList.AddAdvise((short)709, mouseSink, "", "");
                picking=true; pick.Text="Stop clicking"; ShowPrompt();
            } catch (Exception ex) { StopPicking(); status.Text="Direct clicking is unavailable: "+ex.Message+". Select marker shapes instead."; }
        }
        private bool AcceptClick(object eventPage, double x, double y) {
            if (!picking || page != eventPage || next >= prompts.Count) return false;
            try {
                plan.Set(prompts[next],x,y); next++; undo.Enabled=true;
                if (next == prompts.Count) {
                    picking=false; mark.Enabled=false; pick.Enabled=false; draw.Enabled=true;
                    status.Text="All terminal positions recorded. Draw a draft and review every endpoint and route.";
                    BeginInvoke(new Action(StopPicking));
                } else ShowPrompt();
                return true; // Suppress the default Visio action for a recorded click.
            } catch (Exception ex) { status.Text="Could not record: "+ex.Message; return true; }
        }
        private void UndoMark() {
            if (next == 0) return;
            StopPicking(); next--; plan.Remove(prompts[next]); mark.Enabled=true; draw.Enabled=false;
#if EXPERIMENTAL_MOUSE_PICKING
            pick.Enabled=true;
#endif
            undo.Enabled=next>0; ShowPrompt();
        }
        private string ActiveDrawingPath() {
            string path=(string)app.ActiveDocument.FullName;
            if (String.IsNullOrWhiteSpace(path) || !Path.IsPathRooted(path) || !File.Exists(path)) throw new InvalidOperationException("Save the Visio drawing to a local file first.");
            return path;
        }
        private void SaveMarks() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before saving.");
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                string json=MarkPersistence.Serialize(plan,ActiveDrawingPath(),(int)((dynamic)page).ID,next);
                using(var dialog=new SaveFileDialog { Filter="WireFlow terminal marks (*.json)|*.json", AddExtension=true, DefaultExt="json" }) {
                    if(dialog.ShowDialog(this) != DialogResult.OK) return;
                    if (!String.Equals(Path.GetExtension(dialog.FileName),".json",StringComparison.OrdinalIgnoreCase) || String.Equals(Path.GetFullPath(dialog.FileName),Path.GetFullPath(ActiveDrawingPath()),StringComparison.OrdinalIgnoreCase)) throw new InvalidOperationException("Choose a separate .json file for the terminal marks.");
                    File.WriteAllText(dialog.FileName,json,System.Text.Encoding.UTF8);
                    status.Text="Terminal marks saved. Keep the file with the drawing and verify positions after drawing changes.";
                }
            } catch(Exception ex) { status.Text="Could not save terminal marks: "+ex.Message; }
        }
        private void LoadMarks() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before loading.");
                object activePage=app.ActivePage; if (activePage == null) throw new InvalidOperationException("Open the matching Visio page first.");
                string drawingPath=ActiveDrawingPath();
                using(var dialog=new OpenFileDialog { Filter="WireFlow terminal marks (*.json)|*.json", CheckFileExists=true }) {
                    if(dialog.ShowDialog(this) != DialogResult.OK) return;
                    var info=new FileInfo(dialog.FileName); if(info.Length > 1048576) throw new InvalidOperationException("The marking file is too large.");
                    int restoredCount;
                    var restored=MarkPersistence.Deserialize(File.ReadAllText(dialog.FileName),drawingPath,(int)((dynamic)activePage).ID,out restoredCount);
                    StopPicking(); page=activePage; plan.Terminals.Clear(); plan.Modules=restored.Modules;
                    foreach(var entry in restored.Terminals) plan.Terminals.Add(entry.Key,entry.Value);
                    prompts.Clear(); prompts.AddRange(MarkPersistence.Steps(plan.Modules)); count.Value=plan.Modules; next=restoredCount;
                    bool complete=next==prompts.Count; mark.Enabled=!complete; undo.Enabled=next>0; saveMarks.Enabled=true; draw.Enabled=complete;
#if EXPERIMENTAL_MOUSE_PICKING
                    pick.Enabled=!complete;
#else
                    pick.Enabled=false;
#endif
                    if(complete) status.Text="All saved terminals loaded. Verify positions and review routes before drawing.";
                    else ShowPrompt();
                }
            } catch(Exception ex) { status.Text="Could not load terminal marks: "+ex.Message; }
        }
        private void Record() {
            try {
                if (picking) throw new InvalidOperationException("Stop direct clicking before selecting a marker.");
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                dynamic selection=app.ActiveWindow.Selection;
                if ((int)selection.Count != 1) throw new InvalidOperationException("Select exactly one terminal marker shape in Visio.");
                dynamic shape=selection[1];
                double x=shape.CellsU["PinX"].ResultIU; double y=shape.CellsU["PinY"].ResultIU;
                plan.Set(prompts[next],x,y); next++; undo.Enabled=true;
                if (next == prompts.Count) { mark.Enabled=false; pick.Enabled=false; draw.Enabled=true; status.Text="All terminal positions recorded. Draw a draft and review every endpoint and route."; }
                else ShowPrompt();
            } catch (Exception ex) { status.Text="Could not record: "+ex.Message+"\nSelect one marker on the original page and try again."; }
        }
        private void Draw() {
            try {
                if (page != app.ActivePage) throw new InvalidOperationException("Return to the page on which marking started.");
                int n=DraftRenderer.Draw(app,page,plan); draw.Enabled=false; undo.Enabled=false;
                status.Text=n+" draft wire shapes added. Review routes, endpoints, harnesses and approvals. Use Visio Undo to remove this draft.";
            } catch (Exception ex) { status.Text="No complete draft was added: "+ex.Message; }
        }
    }
}
